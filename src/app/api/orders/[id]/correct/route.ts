import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { correctOrder } from "@/ledger/service";
import { buildShare } from "@/entries/save";
import { fail, json, withUser } from "@/lib/api";

interface Body {
  baseRev?: number;
  partyId?: string;
  date?: string;
  promisedDate?: string | null;
  notes?: string | null;
  reason?: string | null;
  lines?: { orderLineId?: string; itemId: string; quantity: string }[];
}

/** Correct an order: saved as a new version; the earlier one is kept. */
export async function POST(req: Request, { params }: RouteContext<"/api/orders/[id]/correct">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as Body;
    if (typeof b.baseRev !== "number" || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    const r = await correctOrder(db, ctxFor(user), id, {
      baseRev: b.baseRev,
      partyId: b.partyId,
      orderDate: b.date,
      promisedDate: b.promisedDate ?? null,
      notes: b.notes ?? null,
      reason: b.reason ?? null,
      lines: b.lines,
    });
    return json({ ok: true, rev: r.rev, share: await buildShare(user, "order", b.partyId, b.lines) });
  });
}
