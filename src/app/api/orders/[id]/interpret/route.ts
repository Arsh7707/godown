import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attachments } from "@/db/schema";
import { ctxFor } from "@/auth/session";
import { orderDetail } from "@/ledger/queries";
import { claudeModels, loadCatalog, SarvamTranscriber } from "@/extraction";
import { interpretChange } from "@/extraction/change";
import { keytermsFor } from "@/extraction/pipeline";
import { ExtractionError } from "@/extraction/types";
import { recordClaudeUsage, recordSpeechUsage, overDailyLimit } from "@/entries/usage";
import { storage } from "@/storage";
import { todayIST } from "@/lib/dates";
import { displayScript } from "@/lib/script";
import { fail, json, withUser } from "@/lib/api";

export const maxDuration = 60;

/**
 * Reads a spoken or typed change to an order and returns the order as it
 * would be after the change. Saves nothing; the user checks it in the form.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/orders/[id]/interpret">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { captureId?: string; text?: string; audioAttachmentId?: string; audioSeconds?: number };
    const captureId = b.captureId && /^[\w-]{8,80}$/.test(b.captureId) ? b.captureId : null;
    if (!captureId) return fail("BAD_CAPTURE_ID");
    const ctx = ctxFor(user);
    const order = await orderDetail(db, ctx, id);
    if (!order.canChange) return fail("FORBIDDEN", 403);
    if (await overDailyLimit(user.companyId)) return fail("AI_LIMIT", 429);

    const signal = AbortSignal.timeout(Number(process.env.EXTRACTION_TIMEOUT_MS ?? 45_000));
    const catalog = await loadCatalog(db, user.companyId, user.stockId);
    const usage: Promise<unknown>[] = [];
    try {
      let instruction = b.text?.trim() ?? "";
      if (b.audioAttachmentId) {
        const [a] = await db.select().from(attachments).where(and(eq(attachments.id, b.audioAttachmentId), eq(attachments.companyId, user.companyId)));
        if (!a) return fail("NOT_FOUND", 404);
        const t = await new SarvamTranscriber().transcribe({ data: await storage().get(a.storageKey), mimeType: a.mimeType.split(";")[0] }, { keyterms: keytermsFor(catalog), signal });
        if (b.audioSeconds) usage.push(recordSpeechUsage(user.companyId, user.userId, captureId, Math.min(b.audioSeconds, 600)));
        instruction = [instruction, t.text.trim()].filter(Boolean).join("\n");
      }
      instruction = displayScript(instruction);
      const models = claudeModels({ onUsage: (u, model) => usage.push(recordClaudeUsage(user.companyId, user.userId, captureId, u, model)) });
      const proposal = await interpretChange(
        { simple: (s, sys, c, sig) => models.simple.json(s, sys, c, sig), complex: (s, sys, c, sig) => models.complex.json(s, sys, c, sig) },
        {
          order: { partyName: order.party.name, orderDate: order.orderDate, promisedDate: order.promisedDate, lines: order.lines },
          catalog,
          instruction,
          today: todayIST(),
          fromVoice: !!b.audioAttachmentId,
        },
        signal,
      );
      await Promise.all(usage);
      return json({ ok: true, proposal, rev: order.rev });
    } catch (e) {
      await Promise.all(usage);
      if (e instanceof ExtractionError) return fail(e.reason === "empty_input" ? "EMPTY" : "READ_FAILED", 422, { message: e.message });
      throw e;
    }
  });
}
