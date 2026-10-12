import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { cancelOrder } from "@/ledger/service";
import { fail, json, withUser } from "@/lib/api";
import { afterStaffAction, afterStockChange } from "@/notify/hooks";

/** Cancel the rest of an order. Goods already sent stay counted against it. */
export async function POST(req: Request, { params }: RouteContext<"/api/orders/[id]/cancel">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { baseRev?: number; reason?: string };
    if (typeof b.baseRev !== "number") return fail("INCOMPLETE");
    const r = await cancelOrder(db, ctxFor(user), id, { baseRev: b.baseRev, reason: b.reason ?? null });
    afterStockChange(user);
    afterStaffAction(user, { action: "order.cancel", partyId: r.partyId, url: `/orders/${id}` });
    return json({ ok: true, rev: r.rev });
  });
}
