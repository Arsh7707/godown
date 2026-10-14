import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { captures, items, parties } from "@/db/schema";
import type { SessionUser } from "@/auth/login";
import { ctxFor } from "@/auth/session";
import { createDispatch, createOrder, getPending, type InputMethod } from "@/ledger/service";
import { balance } from "@/ledger/domain";
import { toPositiveCenti } from "@/lib/qty";
import { shareText, whatsappUrl } from "./share";
import { storedUnit, unitKey, unitLabel } from "@/lib/units";

export interface SaveBody {
  /** Unique per entry. For several parties from one capture: `${captureId}-${index}`. */
  entryCaptureId: string;
  /** The photo/voice/text capture this came from, if any. */
  captureId?: string | null;
  inputMethod: InputMethod;
  partyId: string;
  date: string;
  promisedDate?: string | null;
  notes?: string | null;
  takenBy?: string | null;
  transport?: string | null;
  lrNumber?: string | null;
  parcelPhotoId?: string | null;
  sourceAttachmentId?: string | null;
  sourceText?: string | null;
  applyUnmatched?: boolean;
  lines: { itemId: string; quantity: string; unit?: string | null }[];
  /** Picked suggestions with what was written/said, to learn as extra names. */
  learn?: unknown;
}

export async function saveEntry(user: SessionUser, kind: "order" | "dispatch", b: SaveBody) {
  const ctx = ctxFor(user);
  const common = {
    captureId: b.entryCaptureId,
    channel: "app" as const,
    inputMethod: b.inputMethod,
    partyId: b.partyId,
    notes: b.notes ?? null,
    lines: b.lines,
    sourceAttachmentId: b.sourceAttachmentId ?? null,
    sourceText: b.sourceText ?? null,
  };
  const result =
    kind === "order"
      ? await createOrder(db, ctx, { ...common, orderDate: b.date, promisedDate: b.promisedDate ?? null, applyUnmatched: !!b.applyUnmatched })
      : await createDispatch(db, ctx, {
          ...common,
          dispatchDate: b.date,
          takenBy: b.takenBy ?? null,
          transport: b.transport ?? null,
          lrNumber: b.lrNumber ?? null,
          parcelPhotoId: b.parcelPhotoId ?? null,
        });

  if (b.captureId) {
    await db
      .update(captures)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(and(eq(captures.companyId, user.companyId), eq(captures.captureId, b.captureId)));
  }

  return { result, share: await buildShare(user, kind, b.partyId, b.lines) };
}

/** Share line for a party's entry, with balances as they are now. */
export async function buildShare(user: SessionUser, kind: "order" | "dispatch", partyId: string, entryLines: { itemId: string; quantity: string; unit?: string | null }[]) {
  const ctx = ctxFor(user);
  const itemIds = [...new Set(entryLines.map((l) => l.itemId))];
  const [[party], its, pending] = await Promise.all([
    db.select({ name: parties.name }).from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, user.companyId))),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(and(eq(items.companyId, user.stockId), inArray(items.id, itemIds))),
    getPending(db, ctx, { partyId }),
  ]);
  const itemById = new Map(its.map((i) => [i.id, i]));
  // One part per item AND unit, as said; the stored unit is null for the item's own unit.
  const qty = new Map<string, { itemId: string; unit: string | null; q: number }>();
  for (const l of entryLines) {
    const it = itemById.get(l.itemId);
    const u = it ? (storedUnit(l.unit, it.unit) ?? null) : null;
    const k = unitKey(l.itemId, u);
    const cur = qty.get(k) ?? { itemId: l.itemId, unit: u, q: 0 };
    cur.q += toPositiveCenti(l.quantity);
    qty.set(k, cur);
  }
  const lines = [...qty.values()].map((x) => ({
    itemName: itemById.get(x.itemId)?.name ?? "?",
    unit: unitLabel(x.unit, itemById.get(x.itemId)?.unit ?? ""),
    quantity: x.q,
    balance: pending.lines.filter((l) => l.itemId === x.itemId && (l.unit ?? null) === x.unit).reduce((s, l) => s + balance(l), 0),
  }));
  const text = shareText(user.language, kind, party?.name ?? "?", lines);
  return { text, url: whatsappUrl(text) };
}
