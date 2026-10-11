import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attachments } from "@/db/schema";
import { storage } from "@/storage";
import { fail, json, withUser } from "@/lib/api";

const KINDS = ["slip_photo", "voice_note", "parcel_photo"] as const;
type Kind = (typeof KINDS)[number];
const LIMITS: Record<Kind, { mimes: RegExp; max: number }> = {
  slip_photo: { mimes: /^image\/(jpeg|png|webp)$/, max: 7_000_000 },
  parcel_photo: { mimes: /^image\/(jpeg|png|webp)$/, max: 7_000_000 },
  voice_note: { mimes: /^audio\/(webm|ogg|opus|mp4|mpeg|aac|wav|x-m4a|amr)(;.*)?$/, max: 10_000_000 },
};
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/wav": "wav", "audio/opus": "ogg", "audio/amr": "amr" };

/** Idempotent: the same capture id + kind returns the already-stored file. */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const form = await req.formData();
    const captureId = String(form.get("captureId") ?? "");
    const kind = String(form.get("kind") ?? "") as Kind;
    const file = form.get("file");
    if (!/^[\w-]{8,80}$/.test(captureId)) return fail("BAD_CAPTURE_ID");
    if (!KINDS.includes(kind)) return fail("BAD_KIND");
    if (!(file instanceof File)) return fail("NO_FILE");

    const [existing] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(eq(attachments.companyId, user.companyId), eq(attachments.captureId, captureId), eq(attachments.kind, kind)));
    if (existing) return json({ ok: true, attachmentId: existing.id, duplicate: true });

    const mime = file.type || "application/octet-stream";
    if (!LIMITS[kind].mimes.test(mime)) return fail("BAD_FILE_TYPE", 415);
    if (file.size > LIMITS[kind].max) return fail("FILE_TOO_LARGE", 413);

    const key = `${user.companyId}/${captureId}/${kind}.${EXT[mime.split(";")[0]] ?? "bin"}`;
    await storage().put(key, Buffer.from(await file.arrayBuffer()), mime);
    const [row] = await db
      .insert(attachments)
      .values({ companyId: user.companyId, captureId, kind, storageKey: key, mimeType: mime, sizeBytes: file.size, createdBy: user.userId })
      .onConflictDoNothing()
      .returning({ id: attachments.id });
    if (row) return json({ ok: true, attachmentId: row.id });
    // Lost a race with an identical upload.
    const [again] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(eq(attachments.companyId, user.companyId), eq(attachments.captureId, captureId), eq(attachments.kind, kind)));
    return json({ ok: true, attachmentId: again.id, duplicate: true });
  });
}
