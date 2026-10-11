import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { captures, items } from "@/db/schema";
import { ctxFor } from "@/auth/session";
import { recordStock, type StockEntryKind } from "@/stock/service";
import { stockShareText, whatsappUrl } from "@/entries/share";
import type { InputMethod } from "@/ledger/service";
import { fail, json, withUser } from "@/lib/api";
import { unitLabel } from "@/lib/units";

interface Body {
  entryCaptureId?: string;
  captureId?: string | null;
  kind?: StockEntryKind;
  date?: string;
  notes?: string | null;
  inputMethod?: InputMethod;
  sourceAttachmentId?: string | null;
  sourceText?: string | null;
  lines?: { itemId: string; quantity: string; unit?: string | null }[];
}

/** Goods in, a stock count, or an adjustment. */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as Body;
    if (!b.entryCaptureId || !b.date || !b.lines?.length || !["receipt", "count", "adjustment"].includes(b.kind ?? "")) return fail("INCOMPLETE");
    const r = await recordStock(db, ctxFor(user), {
      captureId: b.entryCaptureId,
      kind: b.kind!,
      date: b.date,
      lines: b.lines,
      reason: b.notes ?? null,
      channel: "app",
      inputMethod: b.inputMethod ?? "form",
      sourceAttachmentId: b.sourceAttachmentId ?? null,
      sourceText: b.sourceText ?? null,
    });
    if (b.captureId) {
      await db
        .update(captures)
        .set({ status: "confirmed", updatedAt: new Date() })
        .where(and(eq(captures.companyId, user.companyId), eq(captures.captureId, b.captureId)));
    }
    if (r.duplicate) return json({ ok: true, duplicate: true, share: null });
    const its = await db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(inArray(items.id, r.lines.map((l) => l.itemId)));
    const item = new Map(its.map((i) => [i.id, i]));
    const text = stockShareText(
      user.language,
      b.kind!,
      r.lines.map((l) => ({ itemName: item.get(l.itemId)?.name ?? "?", unit: unitLabel(l.unit, item.get(l.itemId)?.unit ?? ""), change: l.change, after: l.after })),
    );
    return json({ ok: true, batchId: r.batchId, share: { text, url: whatsappUrl(text) } });
  });
}
