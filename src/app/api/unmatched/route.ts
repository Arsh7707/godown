import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { findUnmatched, linkMany } from "@/ledger/service";
import { markUnmatchedOk, orderFromUnmatched, reopenUnmatched } from "@/ledger/unmatched";
import { fail, json, withUser, readJson } from "@/lib/api";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Settle unmatched goods: link to orders, mark OK / reopen, or make an order for them. */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const ctx = ctxFor(user);
    const b = (await readJson(req)) as Record<string, unknown>;
    const id = (k: string) => (typeof b[k] === "string" && UUID.test(b[k] as string) ? (b[k] as string) : null);
    switch (b.action) {
      case "link": {
        const links = Array.isArray(b.links) ? (b.links as Record<string, unknown>[]).slice(0, 200) : [];
        const clean = links
          .filter((l) => l && typeof l.dispatchLineId === "string" && typeof l.orderLineId === "string" && (typeof l.quantity === "string" || typeof l.quantity === "number"))
          .map((l) => ({ dispatchLineId: l.dispatchLineId as string, orderLineId: l.orderLineId as string, quantity: l.quantity as string | number }));
        if (clean.length !== links.length || !clean.length) return fail("NO_LINES");
        const r = await linkMany(db, ctx, clean);
        return json({ ok: true, linked: r.length });
      }
      case "ok":
        if (!id("dispatchLineId")) return fail("NOT_FOUND", 404);
        return json({ ok: true, ...(await markUnmatchedOk(db, ctx, id("dispatchLineId")!, typeof b.reason === "string" ? b.reason : null)) });
      case "reopen":
        if (!id("dispatchLineId")) return fail("NOT_FOUND", 404);
        return json({ ok: true, ...(await reopenUnmatched(db, ctx, id("dispatchLineId")!)) });
      case "order": {
        const lineIds = Array.isArray(b.dispatchLineIds) ? (b.dispatchLineIds as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
        if (!id("partyId") || !lineIds.length) return fail("NO_LINES");
        // The client sends an id per press: pressing twice makes one order.
        const r = await orderFromUnmatched(db, ctx, id("partyId")!, lineIds, id("captureId") ?? undefined);
        return json({ ok: true, ...r });
      }
      default:
        return fail("UNKNOWN_ACTION");
    }
  });
}
