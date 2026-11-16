import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { cancelBill } from "@/billing/service";
import { fail, json, withUser, readJson } from "@/lib/api";

/** Cancel a bill; its number stays used. */
export async function POST(req: Request, { params }: RouteContext<"/api/bills/[id]/cancel">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await readJson(req)) as { baseRev?: number; reason?: string };
    if (typeof b.baseRev !== "number") return fail("INCOMPLETE");
    await cancelBill(db, ctxFor(user), id, { baseRev: b.baseRev, reason: b.reason ?? null });
    return json({ ok: true });
  });
}
