/**
 * Read models for the Pending and Order screens.
 */
import { displayTaxId } from "@/lib/india";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import { allocations, dispatchLines, dispatchRevisions, dispatches, items, orderLines, orderRevisions, orders, parties, users } from "@/db/schema";
import { todayIST } from "@/lib/dates";
import { toCenti } from "@/lib/qty";
import { LedgerError } from "@/lib/errors";
import { unitKey, unitLabel } from "@/lib/units";
import { balance, cancelledQty, daysOld, isOverdue } from "./domain";
import { currentDispatchRevisions, currentOrderRevisions, loadState } from "./state";
import { canChange, stockOf, type Ctx } from "./service";

export interface PendingItemRow {
  itemId: string;
  /** The line's packing unit as stored (null = item's own unit); `unit` is what to show. */
  unitCode: string | null;
  itemName: string;
  unit: string;
  ordered: number;
  sent: number;
  balance: number;
}

export interface PendingParty {
  partyId: string;
  partyName: string;
  items: PendingItemRow[];
  oldestDays: number | null;
  overdueLines: number;
}

export interface PendingItem extends PendingItemRow {
  parties: number;
  oldestDays: number | null;
  overdueLines: number;
}

/** Open balances by party (per item; units differ so they are never added across items) and by item. */
export async function pendingOverview(db: Db, ctx: Ctx, opts: { includeSettled?: boolean } = {}) {
  const today = todayIST(ctx.now);
  const { lines } = await loadState(db, ctx.companyId);
  const [ps, its] = await Promise.all([
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.companyId, ctx.companyId)),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, stockOf(ctx))),
  ]);
  const partyName = new Map(ps.map((p) => [p.id, p.name]));
  const item = new Map(its.map((i) => [i.id, i]));

  const byParty = new Map<string, PendingParty>();
  const byItem = new Map<string, PendingItem & { partySet: Set<string> }>();
  for (const l of lines) {
    const b = balance(l);
    if (!b && !opts.includeSettled) continue;
    const it = item.get(l.itemId)!;
    const age = b ? daysOld(l, today) : null;
    const overdue = isOverdue(l, today) ? 1 : 0;

    const p = byParty.get(l.partyId) ?? { partyId: l.partyId, partyName: partyName.get(l.partyId) ?? "?", items: [], oldestDays: null, overdueLines: 0 };
    // One row per item AND unit: 20 pcs and 2 dabba are never added together.
    let row = p.items.find((r) => r.itemId === l.itemId && r.unitCode === (l.unit ?? null));
    if (!row) p.items.push((row = { itemId: l.itemId, unitCode: l.unit ?? null, itemName: it.name, unit: unitLabel(l.unit, it.unit), ordered: 0, sent: 0, balance: 0 }));
    row.ordered += l.ordered - cancelledQty(l);
    row.sent += l.dispatched;
    row.balance += b;
    if (age !== null) p.oldestDays = Math.max(p.oldestDays ?? 0, age);
    p.overdueLines += overdue;
    byParty.set(l.partyId, p);

    const k = unitKey(l.itemId, l.unit);
    const i = byItem.get(k) ?? { itemId: l.itemId, unitCode: l.unit ?? null, itemName: it.name, unit: unitLabel(l.unit, it.unit), ordered: 0, sent: 0, balance: 0, parties: 0, oldestDays: null, overdueLines: 0, partySet: new Set<string>() };
    i.ordered += l.ordered - cancelledQty(l);
    i.sent += l.dispatched;
    i.balance += b;
    if (b) i.partySet.add(l.partyId);
    if (age !== null) i.oldestDays = Math.max(i.oldestDays ?? 0, age);
    i.overdueLines += overdue;
    byItem.set(k, i);
  }

  const partiesOut = [...byParty.values()]
    .map((p) => ({ ...p, items: p.items.sort((a, b) => a.itemName.localeCompare(b.itemName) || (a.unitCode ?? "").localeCompare(b.unitCode ?? "")) }))
    .sort((a, b) => b.overdueLines - a.overdueLines || (b.oldestDays ?? -1) - (a.oldestDays ?? -1) || a.partyName.localeCompare(b.partyName));
  const itemsOut: PendingItem[] = [...byItem.values()]
    .map(({ partySet, ...i }) => ({ ...i, parties: partySet.size }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || (a.unitCode ?? "").localeCompare(b.unitCode ?? ""));
  return { today, parties: partiesOut, items: itemsOut };
}

/** One party's open orders, oldest first. */
export async function partyOrders(db: Db, ctx: Ctx, partyId: string) {
  const today = todayIST(ctx.now);
  const [party] = await db.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, ctx.companyId)));
  if (!party) throw new LedgerError("NOT_FOUND", "Party not found");
  const { lines } = await loadState(db, ctx.companyId, { partyId });
  const its = await db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, stockOf(ctx)));
  const item = new Map(its.map((i) => [i.id, i]));
  const ordersById = new Map<string, { orderId: string; orderDate: string; promisedDate: string | null; status: string; daysOld: number; overdue: boolean; lines: (PendingItemRow & { cancelled: number })[] }>();
  for (const l of lines) {
    const o = ordersById.get(l.orderId) ?? { orderId: l.orderId, orderDate: l.orderDate, promisedDate: l.promisedDate, status: l.status, daysOld: daysOld(l, today), overdue: false, lines: [] };
    const it = item.get(l.itemId)!;
    o.lines.push({ itemId: l.itemId, unitCode: l.unit ?? null, itemName: it.name, unit: unitLabel(l.unit, it.unit), ordered: l.ordered, sent: l.dispatched, balance: balance(l), cancelled: cancelledQty(l) });
    o.overdue ||= isOverdue(l, today);
    ordersById.set(l.orderId, o);
  }
  const all = [...ordersById.values()].sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  return {
    party: { id: party.id, name: party.name, city: party.city, state: party.state, taxIdType: party.taxIdType, taxId: displayTaxId(party.taxIdType, party.taxId) },
    open: all.filter((o) => o.lines.some((l) => l.balance > 0)).reverse(),
    closed: all.filter((o) => !o.lines.some((l) => l.balance > 0)).reverse(),
  };
}

/** A dispatch's current version, to pre-fill the edit form. */
export async function dispatchForEdit(db: Db, ctx: Ctx, dispatchId: string) {
  const [d] = await db.select().from(dispatches).where(and(eq(dispatches.id, dispatchId), eq(dispatches.companyId, ctx.companyId)));
  if (!d) throw new LedgerError("NOT_FOUND", "Dispatch not found");
  const [cur] = await currentDispatchRevisions(db, ctx.companyId, dispatchId);
  const lines = await db.select().from(dispatchLines).where(eq(dispatchLines.dispatchRevisionId, cur.id));
  return {
    dispatchId,
    rev: cur.rev,
    status: cur.status,
    partyId: cur.partyId,
    dispatchDate: cur.dispatchDate,
    takenBy: cur.takenBy,
    transport: cur.transport,
    lrNumber: cur.lrNumber,
    notes: cur.notes,
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unit })),
    canChange: cur.status === "active" && canChange(ctx, d.createdBy, d.createdAt),
  };
}

export interface TimelineEvent {
  at: Date;
  kind: "created" | "corrected" | "cancelled" | "dispatch";
  by: string;
  date?: string;
  text?: string;
  itemName?: string;
  unit?: string;
  quantity?: number;
  takenBy?: string | null;
  transport?: string | null;
  lrNumber?: string | null;
  dispatchId?: string;
  dispatchRev?: number;
  /** This user may edit/cancel this dispatch. */
  canChange?: boolean;
}

/** An order with its lines and a timeline of what happened to it, and who did it. */
export async function orderDetail(db: Db, ctx: Ctx, orderId: string) {
  const today = todayIST(ctx.now);
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.companyId, ctx.companyId)));
  if (!order) throw new LedgerError("NOT_FOUND", "Order not found");
  const revs = await db.select().from(orderRevisions).where(eq(orderRevisions.orderId, orderId)).orderBy(asc(orderRevisions.rev));
  const cur = revs[revs.length - 1];
  const [{ lines }, [party], its, us] = await Promise.all([
    loadState(db, ctx.companyId, { orderId }),
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.id, cur.partyId)),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, stockOf(ctx))),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, ctx.companyId)),
  ]);
  const item = new Map(its.map((i) => [i.id, i]));
  const userName = new Map(us.map((u) => [u.id, u.name]));

  // Allocations to this order's lines from current, active dispatch revisions.
  const activeRevs = new Map((await currentDispatchRevisions(db, ctx.companyId)).filter((r) => r.status === "active").map((r) => [r.id, r]));
  const lineIds = lines.map((l) => l.orderLineId);
  const allocs = lineIds.length
    ? await db
        .select({
          quantity: allocations.quantity,
          orderLineId: allocations.orderLineId,
          revisionId: dispatchLines.dispatchRevisionId,
          itemId: dispatchLines.itemId,
          lineUnit: dispatchLines.unit,
          dispatchCreatedBy: dispatches.createdBy,
          dispatchCreatedAt: dispatches.createdAt,
        })
        .from(allocations)
        .innerJoin(dispatchLines, eq(dispatchLines.id, allocations.dispatchLineId))
        .innerJoin(dispatchRevisions, eq(dispatchRevisions.id, dispatchLines.dispatchRevisionId))
        .innerJoin(dispatches, eq(dispatches.id, dispatchRevisions.dispatchId))
        .where(inArray(allocations.orderLineId, lineIds))
    : [];

  const events: TimelineEvent[] = revs.map((r) => ({
    at: r.createdAt,
    kind: r.rev === 1 ? "created" : r.status === "cancelled" ? "cancelled" : "corrected",
    by: userName.get(r.createdBy) ?? "?",
    text: r.reason ?? undefined,
  }));
  for (const a of allocs) {
    const r = activeRevs.get(a.revisionId);
    if (!r) continue; // superseded or cancelled dispatch
    const it = item.get(a.itemId)!;
    events.push({
      at: r.createdAt,
      kind: "dispatch",
      by: userName.get(r.createdBy) ?? "?",
      date: r.dispatchDate,
      itemName: it.name,
      unit: unitLabel(a.lineUnit, it.unit),
      quantity: toCenti(a.quantity),
      takenBy: r.takenBy,
      transport: r.transport,
      lrNumber: r.lrNumber,
      dispatchId: r.dispatchId,
      dispatchRev: r.rev,
      canChange: canChange(ctx, a.dispatchCreatedBy, a.dispatchCreatedAt),
    });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    orderId,
    rev: cur.rev,
    party: party!,
    canChange: cur.status === "open" && canChange(ctx, order.createdBy, order.createdAt),
    status: cur.status,
    orderDate: cur.orderDate,
    promisedDate: cur.promisedDate,
    notes: cur.notes,
    channel: revs[0].channel,
    inputMethod: revs[0].inputMethod,
    createdBy: userName.get(order.createdBy) ?? "?",
    daysOld: daysOld({ orderDate: cur.orderDate }, today),
    overdue: lines.some((l) => isOverdue(l, today)),
    lines: lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        orderLineId: l.orderLineId,
        itemId: l.itemId,
        unitCode: l.unit ?? null,
        itemName: item.get(l.itemId)!.name,
        unit: unitLabel(l.unit, item.get(l.itemId)!.unit),
        ordered: l.ordered,
        sent: l.dispatched,
        balance: balance(l),
        cancelled: cancelledQty(l),
      })),
    events,
  };
}

export interface DispatchSummary {
  dispatchId: string;
  rev: number;
  status: "active" | "cancelled";
  partyId: string;
  partyName: string;
  dispatchDate: string;
  takenBy: string | null;
  transport: string | null;
  lrNumber: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  inputMethod: string;
  lines: { itemId: string; unitCode: string | null; itemName: string; unit: string; quantity: number }[];
  /** Part of the dispatch that matched no open order. */
  unmatched: number;
  canChange: boolean;
}

/** Dispatches as they stand now (latest version), newest first. */
export async function dispatchList(
  db: Db,
  ctx: Ctx,
  opts: { partyId?: string; dispatchId?: string; includeCancelled?: boolean; limit?: number } = {},
): Promise<DispatchSummary[]> {
  let revs = await currentDispatchRevisions(db, ctx.companyId, opts.dispatchId);
  if (!opts.includeCancelled) revs = revs.filter((r) => r.status === "active");
  if (opts.partyId) revs = revs.filter((r) => r.partyId === opts.partyId);
  revs.sort((a, b) => b.dispatchDate.localeCompare(a.dispatchDate) || b.createdAt.getTime() - a.createdAt.getTime());
  revs = revs.slice(0, opts.limit ?? 200);
  if (!revs.length) return [];

  const revIds = revs.map((r) => r.id);
  const [lines, heads, ps, its, us] = await Promise.all([
    db.select().from(dispatchLines).where(inArray(dispatchLines.dispatchRevisionId, revIds)),
    db.select().from(dispatches).where(inArray(dispatches.id, revs.map((r) => r.dispatchId))),
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.companyId, ctx.companyId)),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, stockOf(ctx))),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, ctx.companyId)),
  ]);
  const allocs = lines.length
    ? await db
        .select({ dispatchLineId: allocations.dispatchLineId, quantity: allocations.quantity })
        .from(allocations)
        .where(inArray(allocations.dispatchLineId, lines.map((l) => l.id)))
    : [];
  const allocated = new Map<string, number>();
  for (const a of allocs) allocated.set(a.dispatchLineId, (allocated.get(a.dispatchLineId) ?? 0) + toCenti(a.quantity));
  const head = new Map(heads.map((h) => [h.id, h]));
  const partyName = new Map(ps.map((p) => [p.id, p.name]));
  const item = new Map(its.map((i) => [i.id, i]));
  const userName = new Map(us.map((u) => [u.id, u.name]));

  return revs.map((r) => {
    const h = head.get(r.dispatchId)!;
    const ls = lines.filter((l) => l.dispatchRevisionId === r.id);
    return {
      dispatchId: r.dispatchId,
      rev: r.rev,
      status: r.status,
      partyId: r.partyId,
      partyName: partyName.get(r.partyId) ?? "?",
      dispatchDate: r.dispatchDate,
      takenBy: r.takenBy,
      transport: r.transport,
      lrNumber: r.lrNumber,
      notes: r.notes,
      createdBy: userName.get(h.createdBy) ?? "?",
      createdAt: h.createdAt,
      inputMethod: r.inputMethod,
      lines: ls.map((l) => ({ itemId: l.itemId, unitCode: l.unit, itemName: item.get(l.itemId)?.name ?? "?", unit: unitLabel(l.unit, item.get(l.itemId)?.unit ?? ""), quantity: toCenti(l.quantity) })),
      unmatched: r.status === "active" ? ls.reduce((s, l) => s + toCenti(l.quantity) - (allocated.get(l.id) ?? 0), 0) : 0,
      canChange: r.status === "active" && canChange(ctx, h.createdBy, h.createdAt),
    };
  });
}

/** One dispatch: its lines, which orders they were counted against, and its history. */
export async function dispatchDetail(db: Db, ctx: Ctx, dispatchId: string) {
  const [h] = await db.select().from(dispatches).where(and(eq(dispatches.id, dispatchId), eq(dispatches.companyId, ctx.companyId)));
  if (!h) throw new LedgerError("NOT_FOUND", "Dispatch not found");
  const [summary] = await dispatchList(db, ctx, { dispatchId, includeCancelled: true });
  const revs = await db.select().from(dispatchRevisions).where(eq(dispatchRevisions.dispatchId, dispatchId)).orderBy(asc(dispatchRevisions.rev));
  const cur = revs[revs.length - 1];
  const lines = await db.select().from(dispatchLines).where(eq(dispatchLines.dispatchRevisionId, cur.id));
  const allocs = lines.length
    ? await db
        .select({ quantity: allocations.quantity, itemId: dispatchLines.itemId, unit: dispatchLines.unit, orderId: orderLines.orderId })
        .from(allocations)
        .innerJoin(dispatchLines, eq(dispatchLines.id, allocations.dispatchLineId))
        .innerJoin(orderLines, eq(orderLines.id, allocations.orderLineId))
        .where(inArray(allocations.dispatchLineId, lines.map((l) => l.id)))
    : [];
  const orderRevs = allocs.length ? await currentOrderRevisions(db, ctx.companyId) : [];
  const orderDate = new Map(orderRevs.map((r) => [r.orderId, r.orderDate]));
  const us = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, ctx.companyId));
  const userName = new Map(us.map((u) => [u.id, u.name]));
  return {
    ...summary,
    goesTo: allocs.map((a) => ({ orderId: a.orderId, orderDate: orderDate.get(a.orderId) ?? "", itemId: a.itemId, unitCode: a.unit, quantity: toCenti(a.quantity) })),
    history: revs.map((r) => ({ rev: r.rev, status: r.status, by: userName.get(r.createdBy) ?? "?", at: r.createdAt, reason: r.reason })),
  };
}
