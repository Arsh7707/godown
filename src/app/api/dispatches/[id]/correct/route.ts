import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { correctDispatch } from "@/ledger/service";
import { buildShare } from "@/entries/save";
import { fail, json, withUser } from "@/lib/api";
import { afterDispatch } from "@/notify/hooks";
import { dispatchForEdit } from "@/ledger/queries";
import { toCenti } from "@/lib/qty";
import { unitKey } from "@/lib/units";

interface Body {
  baseRev?: number;
  partyId?: string;
  date?: string;
  takenBy?: string | null;
  transport?: string | null;
  lrNumber?: string | null;
  notes?: string | null;
  reason?: string | null;
  lines?: { itemId: string; quantity: string; unit?: string | null }[];
}

/** Correct a dispatch: new version, and the goods are counted against orders again (oldest first). */
export async function POST(req: Request, { params }: RouteContext<"/api/dispatches/[id]/correct">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as Body;
    if (typeof b.baseRev !== "number" || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    // Only lines that now send more than before can newly go over stock.
    const before = new Map<string, number>();
    for (const l of (await dispatchForEdit(db, ctxFor(user), id)).lines) before.set(unitKey(l.itemId, l.unit), (before.get(unitKey(l.itemId, l.unit)) ?? 0) + toCenti(l.quantity));
    const after = new Map<string, number>();
    for (const l of b.lines) after.set(unitKey(l.itemId, l.unit), (after.get(unitKey(l.itemId, l.unit)) ?? 0) + toCenti(l.quantity));
    const r = await correctDispatch(db, ctxFor(user), id, {
      baseRev: b.baseRev,
      partyId: b.partyId,
      dispatchDate: b.date,
      takenBy: b.takenBy ?? null,
      transport: b.transport ?? null,
      lrNumber: b.lrNumber ?? null,
      notes: b.notes ?? null,
      reason: b.reason ?? null,
      lines: b.lines,
    });
    afterDispatch(user, b.partyId, b.lines, new Set([...after].filter(([k, q]) => q > (before.get(k) ?? 0)).map(([k]) => k)));
    return json({ ok: true, rev: r.rev, plan: r.plan, share: await buildShare(user, "dispatch", b.partyId, b.lines) });
  });
}
