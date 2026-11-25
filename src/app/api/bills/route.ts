import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { createBill, shippingIn, type BillInput } from "@/billing/service";
import { fail, json, withUser, readJson } from "@/lib/api";

/** Make the bill for a dispatch (owners and supervisors). */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await readJson(req)) as BillInput & { dispatchId?: string };
    if (typeof b.dispatchId !== "string" || typeof b.billDate !== "string") return fail("INCOMPLETE");
    const r = await createBill(db, ctxFor(user), b.dispatchId, { kind: b.kind, billDate: b.billDate, lines: b.lines, charges: b.charges, notes: b.notes ?? null, ...shippingIn(b) });
    return json({ ok: true, ...r });
  });
}
