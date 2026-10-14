/**
 * Goods sent that no order covers ("unmatched"): why they happen (sent before
 * the order was entered, sent to the wrong party, a sample, an order typed
 * with another unit) and the three ways to settle them:
 *
 * - Link to an open order of the same party, item and unit (owners).
 * - Make an order for them, when the order was never entered (owners and staff).
 * - Mark as OK, when nothing is owed (a sample, a gift, a replacement) (owners).
 *   This only hides it from this list and the morning reminder; it is kept in
 *   the audit log and can be reopened. Correcting the dispatch starts over
 *   (the corrected lines are new lines).
 *
 * "Mark as OK" is stored in the audit log (latest of ok/reopen per dispatch
 * line wins), so it needs no table of its own.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, items, parties, users } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { centiToDecimal } from "@/lib/qty";
import { daysBetween, todayIST } from "@/lib/dates";
import { unitKey, unitLabel } from "@/lib/units";
import { randomUUID } from "node:crypto";
import { balance, fifoCompare, unmatched, type DispatchLineState } from "./domain";
import { loadState } from "./state";
import { audit, createOrder, lockFirm, stockOf, type Ctx } from "./service";

const OK = "dispatch.unmatched.ok";
const REOPEN = "dispatch.unmatched.reopen";

/** Dispatch lines marked "OK, nothing owed": id → when, who, why. */
export async function dismissedLines(db: Db, companyId: string) {
  const rows = await db
    .select({ id: auditLog.entityId, action: auditLog.action, at: auditLog.createdAt, userId: auditLog.userId, details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.entityType, "dispatch_line"), inArray(auditLog.action, [OK, REOPEN])))
    .orderBy(desc(auditLog.createdAt));
  const out = new Map<string, { at: Date; userId: string; reason: string | null }>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.action === OK) out.set(r.id, { at: r.at, userId: r.userId, reason: ((r.details as { reason?: string }).reason ?? null) || null });
  }
  return out;
}

export interface UnmatchedLine {
  dispatchLineId: string;
  dispatchId: string;
  dispatchDate: string;
  days: number;
  itemId: string;
  itemName: string;
  unitCode: string | null;
  unit: string;
  sent: number;
  unmatched: number;
  /** Open order lines of the same party, item and unit, oldest first. */
  orders: { orderLineId: string; orderId: string; orderDate: string; balance: number }[];
  /** What linking oldest-first would do with this line. */
  suggestion: { orderLineId: string; quantity: number }[];
  dismissed?: { at: Date; by: string; reason: string | null };
}

export interface UnmatchedParty {
  partyId: string;
  partyName: string;
  lines: UnmatchedLine[];
}

/** Everything unmatched, by party; "marked OK" lines separately. */
export async function unmatchedOverview(db: Db, ctx: Ctx): Promise<{ open: UnmatchedParty[]; dismissed: UnmatchedParty[]; count: number }> {
  const today = todayIST(ctx.now);
  const [state, ok] = await Promise.all([loadState(db, ctx.companyId), dismissedLines(db, ctx.companyId)]);
  const pending = state.dispatchLines.filter((d) => unmatched(d) > 0);
  if (!pending.length) return { open: [], dismissed: [], count: 0 };
  const [ps, its, us] = await Promise.all([
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.companyId, ctx.companyId)),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(eq(items.companyId, stockOf(ctx))),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, ctx.companyId)),
  ]);
  const partyName = new Map(ps.map((p) => [p.id, p.name]));
  const item = new Map(its.map((i) => [i.id, i]));
  const userName = new Map(us.map((u) => [u.id, u.name]));

  // Suggestions share the open balances: two unmatched lines never both get the same order quantity.
  const openLines = state.lines.filter((l) => balance(l) > 0).sort(fifoCompare);
  const left = new Map(openLines.map((l) => [l.orderLineId, balance(l)]));
  const sorted = [...pending].sort((a, b) => a.dispatchDate.localeCompare(b.dispatchDate) || a.dispatchCreatedAt.getTime() - b.dispatchCreatedAt.getTime());

  const toLine = (d: DispatchLineState): UnmatchedLine => {
    const it = item.get(d.itemId);
    const same = openLines.filter((l) => l.partyId === d.partyId && l.itemId === d.itemId && (l.unit ?? null) === (d.unit ?? null));
    const suggestion: UnmatchedLine["suggestion"] = [];
    const isOk = ok.get(d.dispatchLineId);
    if (!isOk) {
      let need = unmatched(d);
      for (const l of same) {
        if (!need) break;
        const take = Math.min(need, left.get(l.orderLineId)!);
        if (!take) continue;
        left.set(l.orderLineId, left.get(l.orderLineId)! - take);
        need -= take;
        suggestion.push({ orderLineId: l.orderLineId, quantity: take });
      }
    }
    return {
      dispatchLineId: d.dispatchLineId,
      dispatchId: d.dispatchId,
      dispatchDate: d.dispatchDate,
      days: daysBetween(d.dispatchDate, today),
      itemId: d.itemId,
      itemName: it?.name ?? "?",
      unitCode: d.unit ?? null,
      unit: unitLabel(d.unit, it?.unit ?? ""),
      sent: d.quantity,
      unmatched: unmatched(d),
      orders: same.map((l) => ({ orderLineId: l.orderLineId, orderId: l.orderId, orderDate: l.orderDate, balance: balance(l) })),
      suggestion,
      dismissed: isOk ? { at: isOk.at, by: userName.get(isOk.userId) ?? "?", reason: isOk.reason } : undefined,
    };
  };

  const group = (lines: UnmatchedLine[], partyOf: Map<string, string>) => {
    const by = new Map<string, UnmatchedParty>();
    for (const l of lines) {
      const pid = partyOf.get(l.dispatchLineId)!;
      const g = by.get(pid) ?? { partyId: pid, partyName: partyName.get(pid) ?? "?", lines: [] };
      g.lines.push(l);
      by.set(pid, g);
    }
    // Oldest unsettled first: those are the ones most likely forgotten.
    return [...by.values()].sort((a, b) => Math.max(...b.lines.map((l) => l.days)) - Math.max(...a.lines.map((l) => l.days)) || a.partyName.localeCompare(b.partyName));
  };
  const partyOf = new Map(pending.map((d) => [d.dispatchLineId, d.partyId]));
  const all = sorted.map(toLine);
  const open = all.filter((l) => !l.dismissed);
  return { open: group(open, partyOf), dismissed: group(all.filter((l) => l.dismissed), partyOf), count: open.length };
}

/** Number of open (not marked OK) unmatched dispatch lines, for badges and the morning reminder. */
export async function unmatchedCount(db: Db, companyId: string): Promise<{ lines: number; dispatches: number }> {
  const [state, ok] = await Promise.all([loadState(db, companyId), dismissedLines(db, companyId)]);
  const open = state.dispatchLines.filter((d) => unmatched(d) > 0 && !ok.has(d.dispatchLineId));
  return { lines: open.length, dispatches: new Set(open.map((d) => d.dispatchId)).size };
}

async function currentLine(tx: Db, ctx: Ctx, dispatchLineId: string) {
  const state = await loadState(tx, ctx.companyId);
  const d = state.dispatchLines.find((x) => x.dispatchLineId === dispatchLineId);
  if (!d) throw new LedgerError("NOT_FOUND", "Dispatch line not found or not current");
  return d;
}

/** "Nothing is owed for this" (sample, gift, replacement). Owners only; reason optional. */
export async function markUnmatchedOk(db: Db, ctx: Ctx, dispatchLineId: string, reason?: string | null) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can do this");
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    const d = await currentLine(tx, ctx, dispatchLineId);
    if (unmatched(d) <= 0) throw new LedgerError("ALREADY_CANCELLED", "Nothing unmatched left on this line");
    if ((await dismissedLines(tx, ctx.companyId)).has(dispatchLineId)) return { changed: false };
    await audit(tx, ctx, OK, "dispatch_line", dispatchLineId, { dispatchId: d.dispatchId, itemId: d.itemId, quantity: centiToDecimal(unmatched(d)), reason: reason?.trim().slice(0, 200) || null });
    return { changed: true };
  });
}

export async function reopenUnmatched(db: Db, ctx: Ctx, dispatchLineId: string) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can do this");
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    const d = await currentLine(tx, ctx, dispatchLineId);
    if (!(await dismissedLines(tx, ctx.companyId)).has(dispatchLineId)) return { changed: false };
    await audit(tx, ctx, REOPEN, "dispatch_line", dispatchLineId, { dispatchId: d.dispatchId });
    return { changed: true };
  });
}

/**
 * The order was never entered: make one from what was sent to this party
 * (the chosen lines, by item and unit), dated the day of the earliest of
 * them, and let it take those goods. Owners and staff.
 */
export async function orderFromUnmatched(db: Db, ctx: Ctx, partyId: string, dispatchLineIds: string[], captureId: string = randomUUID()) {
  if (!dispatchLineIds.length) throw new LedgerError("NO_LINES", "Pick at least one line");
  const state = await loadState(db, ctx.companyId, { partyId });
  const chosen = state.dispatchLines.filter((d) => dispatchLineIds.includes(d.dispatchLineId) && unmatched(d) > 0);
  if (chosen.length !== new Set(dispatchLineIds).size) throw new LedgerError("NOT_FOUND", "Some lines are no longer unmatched");
  // The new order takes unmatched goods oldest first; size it on everything unmatched
  // for those items, so it settles exactly them (and nothing is left half-matched).
  const keys = new Set(chosen.map((d) => unitKey(d.itemId, d.unit)));
  const qty = new Map<string, { itemId: string; unit: string | null; q: number }>();
  for (const d of state.dispatchLines) {
    const k = unitKey(d.itemId, d.unit);
    if (!keys.has(k) || unmatched(d) <= 0) continue;
    const cur = qty.get(k) ?? { itemId: d.itemId, unit: d.unit ?? null, q: 0 };
    cur.q += unmatched(d);
    qty.set(k, cur);
  }
  const orderDate = chosen.map((d) => d.dispatchDate).sort()[0];
  const r = await createOrder(db, ctx, {
    captureId,
    partyId,
    orderDate,
    channel: "app",
    inputMethod: "form",
    notes: "Made from goods already sent",
    applyUnmatched: true,
    lines: [...qty.values()].map((x) => ({ itemId: x.itemId, unit: x.unit, quantity: centiToDecimal(x.q) })),
  });
  return { orderId: r.orderId, linked: r.appliedUnmatched.length, duplicate: r.duplicate };
}
