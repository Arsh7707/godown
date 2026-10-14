import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { buildReport } from "@/reports/service";
import { fail, json, withUser } from "@/lib/api";

export async function GET(req: Request) {
  return withUser(async (user) => {
    const q = new URL(req.url).searchParams;
    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to) return fail("INVALID_DATE");
    const slow = Number(q.get("slowDays"));
    return json({ ok: true, report: await buildReport(db, ctxFor(user), { from, to, slowDays: Number.isFinite(slow) && slow > 0 ? slow : undefined }) });
  });
}
