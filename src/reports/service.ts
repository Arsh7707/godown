/**
 * Reports for a date range (IST days, inclusive):
 *
 * - Dispatched: what went out, by day, by client and by item.
 * - Orders received: what was ordered in the range, how much of it has gone, what is left.
 * - Pending now: open balances today (not limited to the range).
 * - Slow stock: items in the godown that haven't gone out for N days.
 *
 * Quantities are never added across units (12 pcs + 3 dabba stays "12 pcs,
 * 3 dabba"). Dispatches count by their current revision: a cancelled dispatch
 * is left out, a corrected one counts as corrected. Owners and viewers.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { items, parties } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { daysBetween, isValidDate, todayIST } from "@/lib/dates";
import { unitKey, unitLabel } from "@/lib/units";
import { balance, isOverdue, daysOld } from "@/ledger/domain";
import { loadState } from "@/ledger/state";
import { stockOf, type Ctx } from "@/ledger/service";
import { loadPoolState, stockOverview } from "@/stock/service";

export const MAX_RANGE_DAYS = 3 * 366;
export const DEFAULT_SLOW_DAYS = 30;

/** Quantity per unit, e.g. { pcs: 1200, dabba: 300 } (centi). */
export type ByUnit = Record<string, number>;

const addTo = (m: ByUnit, unit: string, q: number) => {
  m[unit] = (m[unit] ?? 0) + q;
};

export interface ReportInput {
  from: string;
  to: string;
  slowDays?: number;
}

export async function buildReport(db: Db, ctx: Ctx, input: ReportInput) {
  if (ctx.role === "staff") throw new LedgerError("FORBIDDEN", "Reports are for owners and viewers");
  const today = todayIST(ctx.now);
  if (!isValidDate(input.from) || !isValidDate(input.to)) throw new LedgerError("INVALID_DATE", "Pick valid dates");
  const from = input.from;
  // A range running into the future just stops at today.
  const to = input.to > today ? today : input.to;
  if (from > to) throw new LedgerError("INVALID_DATE", "The start is after the end");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new LedgerError("RANGE_TOO_LONG", "Pick at most 3 years", { max: MAX_RANGE_DAYS });
  const slowDays = Math.min(Math.max(Math.round(input.slowDays ?? DEFAULT_SLOW_DAYS), 1), 3650);

  const stockId = stockOf(ctx);
  const [state, pool, ps, its, stock] = await Promise.all([
    loadState(db, ctx.companyId),
    loadPoolState(db, stockId),
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.companyId, ctx.companyId)),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, stockId)),
    stockOverview(db, ctx),
  ]);
  const partyName = new Map(ps.map((p) => [p.id, p.name]));
  const item = new Map(its.map((i) => [i.id, i]));
  const unitOf = (itemId: string, unit: string | null) => unitLabel(unit, item.get(itemId)?.unit ?? "");
  const nameOf = (itemId: string) => item.get(itemId)?.name ?? "—";
  const inRange = (d: string) => d >= from && d <= to;

  // ---- dispatched
  const sent = state.dispatchLines.filter((d) => inRange(d.dispatchDate));
  const dTotal: ByUnit = {};
  const byDay = new Map<string, { date: string; dispatches: Set<string>; qty: ByUnit }>();
  const dByParty = new Map<string, { partyId: string; name: string; dispatches: Set<string>; qty: ByUnit }>();
  const dByItem = new Map<string, { itemId: string; name: string; unit: string; qty: number; dispatches: Set<string>; parties: Set<string> }>();
  for (const d of sent) {
    const u = unitOf(d.itemId, d.unit);
    addTo(dTotal, u, d.quantity);
    const day = byDay.get(d.dispatchDate) ?? { date: d.dispatchDate, dispatches: new Set(), qty: {} };
    day.dispatches.add(d.dispatchId);
    addTo(day.qty, u, d.quantity);
    byDay.set(d.dispatchDate, day);
    const p = dByParty.get(d.partyId) ?? { partyId: d.partyId, name: partyName.get(d.partyId) ?? "—", dispatches: new Set(), qty: {} };
    p.dispatches.add(d.dispatchId);
    addTo(p.qty, u, d.quantity);
    dByParty.set(d.partyId, p);
    const k = unitKey(d.itemId, d.unit);
    const i = dByItem.get(k) ?? { itemId: d.itemId, name: nameOf(d.itemId), unit: u, qty: 0, dispatches: new Set(), parties: new Set() };
    i.qty += d.quantity;
    i.dispatches.add(d.dispatchId);
    i.parties.add(d.partyId);
    dByItem.set(k, i);
  }

  // ---- orders received in the range (as they stand now)
  const got = state.lines.filter((l) => inRange(l.orderDate));
  const oByParty = new Map<string, { partyId: string; name: string; orders: Set<string>; ordered: ByUnit; sent: ByUnit; pending: ByUnit }>();
  const oByItem = new Map<string, { itemId: string; name: string; unit: string; ordered: number; sent: number; cancelled: number; pending: number }>();
  const orderIds = new Set<string>();
  const cancelledOrders = new Set<string>();
  for (const l of got) {
    const u = unitOf(l.itemId, l.unit);
    orderIds.add(l.orderId);
    if (l.status === "cancelled") cancelledOrders.add(l.orderId);
    const p = oByParty.get(l.partyId) ?? { partyId: l.partyId, name: partyName.get(l.partyId) ?? "—", orders: new Set(), ordered: {}, sent: {}, pending: {} };
    p.orders.add(l.orderId);
    addTo(p.ordered, u, l.ordered);
    addTo(p.sent, u, l.dispatched);
    addTo(p.pending, u, balance(l));
    oByParty.set(l.partyId, p);
    const k = unitKey(l.itemId, l.unit);
    const i = oByItem.get(k) ?? { itemId: l.itemId, name: nameOf(l.itemId), unit: u, ordered: 0, sent: 0, cancelled: 0, pending: 0 };
    i.ordered += l.ordered;
    i.sent += l.dispatched;
    i.pending += balance(l);
    if (l.status === "cancelled") i.cancelled += Math.max(0, l.ordered - l.dispatched);
    oByItem.set(k, i);
  }

  // ---- pending now
  const pByParty = new Map<string, { partyId: string; name: string; pending: ByUnit; oldestDays: number; overdue: number }>();
  const pByItem = new Map<string, { itemId: string; name: string; unit: string; pending: number; parties: Set<string>; overdue: number }>();
  for (const l of state.lines) {
    const b = balance(l);
    if (!b) continue;
    const u = unitOf(l.itemId, l.unit);
    const late = isOverdue(l, today) ? 1 : 0;
    const p = pByParty.get(l.partyId) ?? { partyId: l.partyId, name: partyName.get(l.partyId) ?? "—", pending: {}, oldestDays: 0, overdue: 0 };
    addTo(p.pending, u, b);
    p.oldestDays = Math.max(p.oldestDays, daysOld(l, today));
    p.overdue += late;
    pByParty.set(l.partyId, p);
    const k = unitKey(l.itemId, l.unit);
    const i = pByItem.get(k) ?? { itemId: l.itemId, name: nameOf(l.itemId), unit: u, pending: 0, parties: new Set(), overdue: 0 };
    i.pending += b;
    i.parties.add(l.partyId);
    i.overdue += late;
    pByItem.set(k, i);
  }

  // ---- slow stock: in the godown, not sent for a while (any firm sharing the godown counts as sent)
  const lastSent = new Map<string, string>();
  for (const d of pool.dispatchLines) {
    const k = unitKey(d.itemId, d.unit);
    if (!lastSent.has(k) || lastSent.get(k)! < d.dispatchDate) lastSent.set(k, d.dispatchDate);
  }
  const slow = stock
    .filter((r) => r.inStock > 0)
    .map((r) => {
      const last = lastSent.get(unitKey(r.itemId, r.unitCode)) ?? null;
      return { itemId: r.itemId, name: r.name, unit: r.unit, inStock: r.inStock, free: r.free, lastSent: last, days: last ? daysBetween(last, today) : null };
    })
    .filter((r) => r.days === null || r.days >= slowDays)
    // Never sent first, then longest without going out, then the most stock.
    .sort((a, b) => Number(a.days !== null) - Number(b.days !== null) || (b.days ?? 0) - (a.days ?? 0) || b.inStock - a.inStock);

  const byQty = (a: ByUnit, b: ByUnit) => Math.max(0, ...Object.values(b)) - Math.max(0, ...Object.values(a));
  return {
    from,
    to,
    today,
    slowDays,
    dispatched: {
      dispatches: new Set(sent.map((d) => d.dispatchId)).size,
      total: dTotal,
      byDay: [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)).map((d) => ({ date: d.date, dispatches: d.dispatches.size, qty: d.qty })),
      byParty: [...dByParty.values()].map((p) => ({ partyId: p.partyId, name: p.name, dispatches: p.dispatches.size, qty: p.qty })).sort((a, b) => byQty(a.qty, b.qty) || a.name.localeCompare(b.name)),
      byItem: [...dByItem.values()].map((i) => ({ itemId: i.itemId, name: i.name, unit: i.unit, qty: i.qty, dispatches: i.dispatches.size, parties: i.parties.size })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)),
    },
    orders: {
      orders: orderIds.size,
      cancelledOrders: cancelledOrders.size,
      byParty: [...oByParty.values()].map((p) => ({ partyId: p.partyId, name: p.name, orders: p.orders.size, ordered: p.ordered, sent: p.sent, pending: p.pending })).sort((a, b) => byQty(a.ordered, b.ordered) || a.name.localeCompare(b.name)),
      byItem: [...oByItem.values()].sort((a, b) => b.ordered - a.ordered || a.name.localeCompare(b.name)),
    },
    pending: {
      byParty: [...pByParty.values()].sort((a, b) => b.overdue - a.overdue || b.oldestDays - a.oldestDays || a.name.localeCompare(b.name)),
      byItem: [...pByItem.values()].map((i) => ({ itemId: i.itemId, name: i.name, unit: i.unit, pending: i.pending, parties: i.parties.size, overdue: i.overdue })).sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name)),
    },
    slow,
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;
