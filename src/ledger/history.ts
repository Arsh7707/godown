/**
 * History: everything entered for one day (by the date on the entry), so a
 * past day can be checked, added to, or corrected.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import { dispatchLines, dispatches, items, orderLineVersions, orders, parties, stockMovements, users } from "@/db/schema";
import { formatQty, toCenti } from "@/lib/qty";
import { unitLabel } from "@/lib/units";
import { canChange, type Ctx } from "./service";
import { currentDispatchRevisions, currentOrderRevisions } from "./state";

export interface DayEntry {
  kind: "order" | "dispatch" | "receipt" | "count" | "adjustment" | "reversal";
  id: string;
  partyName: string | null;
  lines: string[];
  by: string;
  enteredAt: Date;
  cancelled: boolean;
  /** Changed after it was first saved. */
  edited: boolean;
  /** Stock entry later undone. */
  undone: boolean;
  canChange: boolean;
  href: string;
}

const signed = (q: string) => (q.startsWith("-") ? -toCenti(q.slice(1)) : toCenti(q));

export async function dayEntries(db: Db, ctx: Ctx, date: string): Promise<DayEntry[]> {
  const [oRevs, dRevs, moves, ps, its, us] = await Promise.all([
    currentOrderRevisions(db, ctx.companyId).then((r) => r.filter((x) => x.orderDate === date)),
    currentDispatchRevisions(db, ctx.companyId).then((r) => r.filter((x) => x.dispatchDate === date)),
    db.select().from(stockMovements).where(and(eq(stockMovements.companyId, ctx.companyId), eq(stockMovements.entryDate, date))),
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.companyId, ctx.companyId)),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, ctx.companyId)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, ctx.companyId)),
  ]);
  const party = new Map(ps.map((p) => [p.id, p.name]));
  const item = new Map(its.map((i) => [i.id, i]));
  const user = new Map(us.map((u) => [u.id, u.name]));
  const line = (itemId: string, qty: number, unit: string | null, sign = false) =>
    `${item.get(itemId)?.name ?? "?"} ${sign && qty > 0 ? "+" : ""}${qty < 0 ? "−" : ""}${formatQty(Math.abs(qty))} ${unitLabel(unit, item.get(itemId)?.unit ?? "")}`;

  const [oLines, oHeads, dLines, dHeads] = await Promise.all([
    oRevs.length ? db.select().from(orderLineVersions).where(inArray(orderLineVersions.orderRevisionId, oRevs.map((r) => r.id))) : [],
    oRevs.length ? db.select().from(orders).where(inArray(orders.id, oRevs.map((r) => r.orderId))) : [],
    dRevs.length ? db.select().from(dispatchLines).where(inArray(dispatchLines.dispatchRevisionId, dRevs.map((r) => r.id))) : [],
    dRevs.length ? db.select().from(dispatches).where(inArray(dispatches.id, dRevs.map((r) => r.dispatchId))) : [],
  ]);
  const oHead = new Map(oHeads.map((h) => [h.id, h]));
  const dHead = new Map(dHeads.map((h) => [h.id, h]));
  const out: DayEntry[] = [];

  for (const r of oRevs) {
    const h = oHead.get(r.orderId)!;
    out.push({
      kind: "order",
      id: r.orderId,
      partyName: party.get(r.partyId) ?? "?",
      lines: oLines.filter((l) => l.orderRevisionId === r.id && toCenti(l.quantity) > 0).map((l) => line(l.itemId, toCenti(l.quantity), l.unit)),
      by: user.get(h.createdBy) ?? "?",
      enteredAt: h.createdAt,
      cancelled: r.status === "cancelled",
      edited: r.rev > 1 && r.status !== "cancelled",
      undone: false,
      canChange: r.status !== "cancelled" && canChange(ctx, h.createdBy, h.createdAt),
      href: `/orders/${r.orderId}`,
    });
  }
  for (const r of dRevs) {
    const h = dHead.get(r.dispatchId)!;
    out.push({
      kind: "dispatch",
      id: r.dispatchId,
      partyName: party.get(r.partyId) ?? "?",
      lines: dLines.filter((l) => l.dispatchRevisionId === r.id).map((l) => line(l.itemId, toCenti(l.quantity), l.unit)),
      by: user.get(h.createdBy) ?? "?",
      enteredAt: h.createdAt,
      cancelled: r.status === "cancelled",
      edited: r.rev > 1 && r.status !== "cancelled",
      undone: false,
      canChange: r.status !== "cancelled" && canChange(ctx, h.createdBy, h.createdAt),
      href: `/dispatches/${r.dispatchId}`,
    });
  }

  // Stock: one entry per batch. Undo rows may be dated another day, so look them up across days.
  const ids = moves.map((m) => m.id);
  const undoneIds = new Set(
    ids.length
      ? (await db.select({ id: stockMovements.reversesId }).from(stockMovements).where(and(eq(stockMovements.companyId, ctx.companyId), inArray(stockMovements.reversesId, ids)))).map((r) => r.id)
      : [],
  );
  const batches = new Map<string, typeof moves>();
  for (const m of moves) batches.set(m.batchId, [...(batches.get(m.batchId) ?? []), m]);
  for (const [batchId, ms] of batches) {
    const first = ms[0];
    out.push({
      kind: first.kind,
      id: batchId,
      partyName: null,
      lines: ms.map((m) => line(m.itemId, first.kind === "count" ? toCenti(m.counted ?? "0") : signed(m.quantity), m.unit, first.kind !== "count")),
      by: user.get(first.createdBy) ?? "?",
      enteredAt: first.createdAt,
      cancelled: false,
      edited: false,
      undone: ms.some((m) => undoneIds.has(m.id)),
      canChange: first.kind !== "reversal" && !ms.some((m) => undoneIds.has(m.id)) && canChange(ctx, first.createdBy, first.createdAt),
      href: `/stock/item/${first.itemId}`,
    });
  }
  return out.sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());
}
