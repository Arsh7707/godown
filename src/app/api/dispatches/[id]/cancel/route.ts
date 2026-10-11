import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { cancelDispatch } from "@/ledger/service";
import { fail, json, withUser } from "@/lib/api";

/** Cancel a dispatch: its goods stop counting and the orders' balances reopen. */
export async function POST(req: Request, { params }: RouteContext<"/api/dispatches/[id]/cancel">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { baseRev?: number; reason?: string };
    if (typeof b.baseRev !== "number") return fail("INCOMPLETE");
    const r = await cancelDispatch(db, ctxFor(user), id, { baseRev: b.baseRev, reason: b.reason ?? null });
    return json({ ok: true, rev: r.rev });
  });
}
