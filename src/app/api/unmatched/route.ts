import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { findUnmatched } from "@/ledger/service";
import { fail, json, withUser } from "@/lib/api";

/** Goods sent to this party with no open order, to offer when a new order is saved. */
export async function GET(req: Request) {
  return withUser(async (user) => {
    const url = new URL(req.url);
    const partyId = url.searchParams.get("partyId");
    if (!partyId) return fail("INCOMPLETE");
    const itemIds = url.searchParams.getAll("itemId");
    const rows = await findUnmatched(db, ctxFor(user), partyId, itemIds.length ? itemIds : undefined);
    return json({ ok: true, unmatched: rows.map((r) => ({ itemId: r.itemId, unit: r.unit, quantity: r.unmatched, dispatchDate: r.dispatchDate })) });
  });
}
