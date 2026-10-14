import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { previewDispatch } from "@/ledger/service";
import { stockLevels } from "@/stock/service";
import { dispatchForEdit } from "@/ledger/queries";
import { toCenti } from "@/lib/qty";
import { unitKey } from "@/lib/units";
import { fail, json, withUser } from "@/lib/api";

/** Where a dispatch would go (oldest open order first) before it is saved. */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { partyId?: string; dispatchDate?: string; lines?: { itemId: string; quantity: string; unit?: string | null }[]; excludeDispatchId?: string };
    if (!b.partyId || !b.dispatchDate || !b.lines?.length) return fail("INCOMPLETE");
    const plan = await previewDispatch(db, ctxFor(user), { partyId: b.partyId, dispatchDate: b.dispatchDate, lines: b.lines }, { excludeDispatchId: b.excludeDispatchId });
    // In-stock count per item, so the form can warn before sending more than is there.
    const levels = await stockLevels(db, user.stockId, [...new Set(b.lines.map((l) => l.itemId))]);
    // Keyed "itemId|unit" (unit empty for the item's own unit).
    const stock: Record<string, number> = Object.fromEntries([...levels].map(([k, v]) => [k, v.inStock]));
    if (b.excludeDispatchId) {
      // Editing a dispatch: its current quantities are already taken out of stock.
      const cur = await dispatchForEdit(db, ctxFor(user), b.excludeDispatchId).catch(() => null);
      for (const l of cur?.status === "active" ? cur.lines : []) stock[unitKey(l.itemId, l.unit)] = (stock[unitKey(l.itemId, l.unit)] ?? 0) + toCenti(l.quantity);
    }
    return json({ ok: true, plan, stock });
  });
}
