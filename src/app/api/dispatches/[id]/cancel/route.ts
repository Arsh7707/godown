import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { cancelDispatch } from "@/ledger/service";
import { fail, json, withUser, readJson } from "@/lib/api";
import { afterStaffAction, afterStockChange } from "@/notify/hooks";

/** Cancel a dispatch: its goods stop counting and the orders' balances reopen. */
export async function POST(req: Request, { params }: RouteContext<"/api/dispatches/[id]/cancel">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await readJson(req)) as { baseRev?: number; reason?: string };
    if (typeof b.baseRev !== "number") return fail("INCOMPLETE");
    const r = await cancelDispatch(db, ctxFor(user), id, { baseRev: b.baseRev, reason: b.reason ?? null });
    afterStockChange(user);
    afterStaffAction(user, { action: "dispatch.cancel", partyId: r.partyId, url: `/dispatches/${id}` });
    return json({ ok: true, rev: r.rev });
  });
}
