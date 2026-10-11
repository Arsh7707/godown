/**
 * Pure ledger logic: balances, FIFO allocation, overdue rules.
 * No I/O here. All quantities are integer hundredths (see lib/qty).
 */
import { daysBetween } from "@/lib/dates";

export type OrderStatus = "open" | "cancelled";

/** One order line as of its order's current revision. */
export interface LineState {
  orderLineId: string;
  orderId: string;
  lineNo: number;
  partyId: string;
  itemId: string;
  /** Packing unit as said; null = the item's own unit. Never converted. */
  unit: string | null;
  orderDate: string;
  promisedDate: string | null;
  orderCreatedAt: Date;
  status: OrderStatus;
  ordered: number;
  /** Sum of allocations from current, active dispatch revisions. */
  dispatched: number;
}

/** One line of a dispatch's current, active revision. */
export interface DispatchLineState {
  dispatchLineId: string;
  dispatchId: string;
  partyId: string;
  itemId: string;
  unit: string | null;
  dispatchDate: string;
  dispatchCreatedAt: Date;
  quantity: number;
  allocated: number;
}

/** Still to send. A cancelled (short-closed) order has nothing left to send. */
export function balance(l: LineState): number {
  if (l.status === "cancelled") return 0;
  return Math.max(0, l.ordered - l.dispatched);
}

/** Quantity that was ordered but will no longer be sent because the order was cancelled. */
export function cancelledQty(l: LineState): number {
  return l.status === "cancelled" ? Math.max(0, l.ordered - l.dispatched) : 0;
}

export function unmatched(d: DispatchLineState): number {
  return d.quantity - d.allocated;
}

/** FIFO order: oldest order date, then earliest entered, then line number. */
export function fifoCompare(a: LineState, b: LineState): number {
  if (a.orderDate !== b.orderDate) return a.orderDate < b.orderDate ? -1 : 1;
  const t = a.orderCreatedAt.getTime() - b.orderCreatedAt.getTime();
  if (t !== 0) return t;
  if (a.orderId !== b.orderId) return a.orderId < b.orderId ? -1 : 1;
  return a.lineNo - b.lineNo;
}

export interface PlannedAllocation {
  orderLineId: string;
  orderId: string;
  orderDate: string;
  quantity: number;
  /** Balance on that order line after this allocation. */
  balanceAfter: number;
}

export interface PlannedDispatchLine {
  itemId: string;
  unit: string | null;
  quantity: number;
  allocations: PlannedAllocation[];
  unmatched: number;
}

/**
 * Allocate dispatch lines to the party's oldest open order lines for each item.
 * Lines are consumed in input order, so two dispatch lines for the same item
 * see each other's allocations. Anything left over is unmatched.
 * Does not mutate `openLines`.
 */
export function planFifo(
  partyId: string,
  openLines: readonly LineState[],
  dispatchLines: readonly { itemId: string; quantity: number; unit?: string | null }[],
): PlannedDispatchLine[] {
  const remaining = new Map<string, number>();
  const candidates = openLines
    .filter((l) => l.partyId === partyId && balance(l) > 0)
    .sort(fifoCompare);
  for (const l of candidates) remaining.set(l.orderLineId, balance(l));

  return dispatchLines.map(({ itemId, quantity, unit = null }) => {
    let left = quantity;
    const allocs: PlannedAllocation[] = [];
    for (const l of candidates) {
      if (left === 0) break;
      // Same item AND same unit: 2 dabba never fills an order for pieces.
      if (l.itemId !== itemId || (l.unit ?? null) !== (unit ?? null)) continue;
      const avail = remaining.get(l.orderLineId)!;
      if (avail === 0) continue;
      const take = Math.min(avail, left);
      remaining.set(l.orderLineId, avail - take);
      left -= take;
      allocs.push({ orderLineId: l.orderLineId, orderId: l.orderId, orderDate: l.orderDate, quantity: take, balanceAfter: avail - take });
    }
    return { itemId, unit: unit ?? null, quantity, allocations: allocs, unmatched: left };
  });
}

export interface PlannedLink {
  dispatchLineId: string;
  orderLineId: string;
  quantity: number;
}

/**
 * Apply a party's unmatched dispatch quantity to a (new) order's lines.
 * Oldest unmatched dispatch first; order lines in line-number order.
 */
export function planApplyUnmatched(
  unmatchedLines: readonly DispatchLineState[],
  orderLinesToFill: readonly LineState[],
): PlannedLink[] {
  const pool = unmatchedLines
    .filter((d) => unmatched(d) > 0)
    .sort(
      (a, b) =>
        (a.dispatchDate < b.dispatchDate ? -1 : a.dispatchDate > b.dispatchDate ? 1 : 0) ||
        a.dispatchCreatedAt.getTime() - b.dispatchCreatedAt.getTime(),
    )
    .map((d) => ({ d, left: unmatched(d) }));

  const links: PlannedLink[] = [];
  for (const line of [...orderLinesToFill].sort((a, b) => a.lineNo - b.lineNo)) {
    let need = balance(line);
    for (const p of pool) {
      if (need === 0) break;
      if (p.left === 0 || p.d.itemId !== line.itemId || (p.d.unit ?? null) !== (line.unit ?? null) || p.d.partyId !== line.partyId) continue;
      const take = Math.min(need, p.left);
      p.left -= take;
      need -= take;
      links.push({ dispatchLineId: p.d.dispatchLineId, orderLineId: line.orderLineId, quantity: take });
    }
  }
  return links;
}

export function daysOld(l: Pick<LineState, "orderDate">, today: string): number {
  return daysBetween(l.orderDate, today);
}

export const OVERDUE_AFTER_DAYS = 4;

/**
 * Overdue: balance remains and either the promised date has passed, or there
 * is no promised date and the order is more than 4 days old.
 */
export function isOverdue(l: LineState, today: string): boolean {
  if (balance(l) === 0) return false;
  if (l.promisedDate) return today > l.promisedDate;
  return daysOld(l, today) > OVERDUE_AFTER_DAYS;
}

export interface PendingRow {
  key: string;
  ordered: number;
  sent: number;
  cancelled: number;
  balance: number;
  /** Age in days of the oldest line that still has a balance; null if nothing pending. */
  oldestDays: number | null;
  overdueLines: number;
}

/** Aggregate line states by a key (party id, item id, ...). Lines of cancelled orders count toward ordered/sent/cancelled. */
export function aggregatePending(lines: readonly LineState[], keyOf: (l: LineState) => string, today: string): PendingRow[] {
  const rows = new Map<string, PendingRow>();
  for (const l of lines) {
    const key = keyOf(l);
    const r = rows.get(key) ?? { key, ordered: 0, sent: 0, cancelled: 0, balance: 0, oldestDays: null, overdueLines: 0 };
    r.ordered += l.ordered;
    r.sent += l.dispatched;
    r.cancelled += cancelledQty(l);
    const b = balance(l);
    r.balance += b;
    if (b > 0) {
      const age = daysOld(l, today);
      r.oldestDays = r.oldestDays === null ? age : Math.max(r.oldestDays, age);
      if (isOverdue(l, today)) r.overdueLines += 1;
    }
    rows.set(key, r);
  }
  return [...rows.values()];
}
