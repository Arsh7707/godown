import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attachments, captures } from "@/db/schema";
import { defaultDeps, loadCatalog, runExtraction } from "@/extraction";
import { emptyDraft } from "@/extraction/draft";
import type { ExtractionResult } from "@/extraction/types";
import { storage } from "@/storage";
import { overDailyLimit, recordClaudeUsage, recordSpeechUsage } from "@/entries/usage";
import { todayIST } from "@/lib/dates";
import { fail, json, withUser } from "@/lib/api";

// Transcription + reading can take ~30s on long voice notes.
export const maxDuration = 60;

interface Body {
  captureId?: string;
  kind?: "order" | "dispatch" | "stock";
  inputMethod?: "photo" | "voice" | "text";
  text?: string;
  imageAttachmentId?: string;
  audioAttachmentId?: string;
  audioSeconds?: number;
}

/**
 * Reads a photo / voice note / typed message into draft entries.
 * Saves nothing to the ledger. Idempotent per capture id.
 */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as Body;
    if (!b.captureId || !/^[\w-]{8,80}$/.test(b.captureId)) return fail("BAD_CAPTURE_ID");
    if (b.kind !== "order" && b.kind !== "dispatch" && b.kind !== "stock") return fail("BAD_KIND");
    if (!["photo", "voice", "text"].includes(b.inputMethod ?? "")) return fail("BAD_INPUT_METHOD");
    if (user.role === "viewer") return fail("FORBIDDEN", 403);

    const [prior] = await db.select().from(captures).where(and(eq(captures.companyId, user.companyId), eq(captures.captureId, b.captureId)));
    if (prior?.result) return json({ ok: true, result: prior.result, duplicate: true });

    const att = async (id?: string) => {
      if (!id) return undefined;
      const [a] = await db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.companyId, user.companyId)));
      if (!a) return undefined;
      return { data: await storage().get(a.storageKey), mimeType: a.mimeType.split(";")[0] };
    };

    let result: ExtractionResult;
    if (await overDailyLimit(user.companyId)) {
      result = {
        ok: false,
        reason: "error",
        message: "Daily AI limit reached; please type this entry.",
        draft: emptyDraft(b.kind, todayIST(), b.text?.trim() || null),
        durationMs: 0,
      };
    } else {
      const catalog = await loadCatalog(db, user.companyId);
      const usage: Promise<unknown>[] = [];
      const deps = defaultDeps({ onUsage: (u, model) => usage.push(recordClaudeUsage(user.companyId, user.userId, b.captureId!, u, model)) });
      const [image, audio] = await Promise.all([att(b.imageAttachmentId), att(b.audioAttachmentId)]);
      result = await runExtraction(deps, { kind: b.kind, catalog, text: b.text, image, audio });
      if (audio && b.audioSeconds) usage.push(recordSpeechUsage(user.companyId, user.userId, b.captureId, Math.min(b.audioSeconds, 600)));
      await Promise.all(usage);
    }

    await db
      .insert(captures)
      .values({
        companyId: user.companyId,
        captureId: b.captureId,
        kind: b.kind,
        channel: "app",
        inputMethod: b.inputMethod as "photo" | "voice" | "text",
        text: b.text?.trim() || (result.ok ? result.sourceText : result.draft.sourceText),
        imageAttachmentId: b.imageAttachmentId ?? null,
        audioAttachmentId: b.audioAttachmentId ?? null,
        status: result.ok ? "extracted" : "failed",
        result,
        createdBy: user.userId,
      })
      .onConflictDoUpdate({ target: [captures.companyId, captures.captureId], set: { result, status: result.ok ? "extracted" : "failed", updatedAt: new Date() } });

    return json({ ok: true, result });
  });
}
