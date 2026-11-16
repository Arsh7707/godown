import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { reviseBill, type BillInput } from "@/billing/service";
import { fail, json, withUser, readJson } from "@/lib/api";

/** Change a bill: a new revision (see billing/service.ts for numbering). */
export async function POST(req: Request, { params }: RouteContext<"/api/bills/[id]">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await readJson(req)) as BillInput & { baseRev?: number; reason?: string };
    if (typeof b.baseRev !== "number" || typeof b.billDate !== "string") return fail("INCOMPLETE");
    const r = await reviseBill(db, ctxFor(user), id, { kind: b.kind, billDate: b.billDate, lines: b.lines, charges: b.charges, notes: b.notes ?? null, baseRev: b.baseRev, reason: b.reason ?? null });
    return json({ ok: true, ...r });
  });
}
