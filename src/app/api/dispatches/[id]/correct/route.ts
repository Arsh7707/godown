import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { correctDispatch } from "@/ledger/service";
import { buildShare } from "@/entries/save";
import { fail, json, withUser } from "@/lib/api";

interface Body {
  baseRev?: number;
  partyId?: string;
  date?: string;
  takenBy?: string | null;
  transport?: string | null;
  lrNumber?: string | null;
  notes?: string | null;
  reason?: string | null;
  lines?: { itemId: string; quantity: string }[];
}

/** Correct a dispatch: new version, and the goods are counted against orders again (oldest first). */
export async function POST(req: Request, { params }: RouteContext<"/api/dispatches/[id]/correct">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as Body;
    if (typeof b.baseRev !== "number" || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    const r = await correctDispatch(db, ctxFor(user), id, {
      baseRev: b.baseRev,
      partyId: b.partyId,
      dispatchDate: b.date,
      takenBy: b.takenBy ?? null,
      transport: b.transport ?? null,
      lrNumber: b.lrNumber ?? null,
      notes: b.notes ?? null,
      reason: b.reason ?? null,
      lines: b.lines,
    });
    return json({ ok: true, rev: r.rev, plan: r.plan, share: await buildShare(user, "dispatch", b.partyId, b.lines) });
  });
}
