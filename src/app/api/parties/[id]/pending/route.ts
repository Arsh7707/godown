import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { partyOrders } from "@/ledger/queries";
import { json, withUser } from "@/lib/api";

/** What is still to send to this party, per item, for one-tap filling of a dispatch. */
export async function GET(_req: Request, { params }: RouteContext<"/api/parties/[id]/pending">) {
  const { id } = await params;
  return withUser(async (user) => {
    const { open } = await partyOrders(db, ctxFor(user), id);
    const byItem = new Map<string, { itemId: string; unitCode: string | null; itemName: string; unit: string; balance: number }>();
    for (const o of open)
      for (const l of o.lines) {
        if (!l.balance) continue;
        const k = `${l.itemId}|${l.unitCode ?? ""}`;
        const r = byItem.get(k) ?? { itemId: l.itemId, unitCode: l.unitCode, itemName: l.itemName, unit: l.unit, balance: 0 };
        r.balance += l.balance;
        byItem.set(k, r);
      }
    return json({ ok: true, items: [...byItem.values()] });
  });
}
