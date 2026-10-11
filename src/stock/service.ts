/**
 * Stock: goods in, physical counts and adjustments, recorded as append-only
 * movements. Nothing is stored as "current stock":
 *
 *   in stock = sum(movements) − dispatched (current, active dispatches)
 *   owed     = balance still to send on open orders
 *   free     = in stock − owed          (low-stock alerts use this)
 *
 * Dispatching more than is in stock is allowed (the user is warned first);
 * stock then shows negative until a count corrects it.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { dispatches, items, parties, stockMovements, users } from "@/db/schema";
import { assertEntryDate, todayIST } from "@/lib/dates";
import { LedgerError } from "@/lib/errors";
import { centiToDecimal, toCenti, toPositiveCenti } from "@/lib/qty";
import { balance } from "@/ledger/domain";
import { loadState } from "@/ledger/state";
import { assertItems, audit, canChange, lockCompany, resolveUnits, type Channel, type Ctx, type InputMethod } from "@/ledger/service";
import { unitKey, unitLabel } from "@/lib/units";

export type StockEntryKind = "receipt" | "count" | "adjustment";

export interface StockEntryInput {
  /** Client id for the whole entry; each line is saved as `${captureId}-${i}`. */
  captureId: string;
  kind: StockEntryKind;
  date: string;
  /** receipt: pieces in (> 0). count: pieces counted (≥ 0). adjustment: signed change (≠ 0). */
  lines: { itemId: string; quantity: string | number; unit?: string | null }[];
  reason?: string | null;
  channel: Channel;
  inputMethod: InputMethod;
  sourceAttachmentId?: string | null;
  sourceText?: string | null;
}

export interface StockLevel {
  itemId: string;
  /** null = the item's own unit. Stock is kept per unit, never converted. */
  unit: string | null;
  /** Sum of goods in, counts, adjustments and reversals (centi). */
  movements: number;
  dispatched: number;
  inStock: number;
}

function parseSigned(q: string | number): number {
  const s = String(q).trim();
  const neg = s.startsWith("-");
  const c = toPositiveCenti(neg ? s.slice(1) : s.replace(/^\+/, ""));
  return neg ? -c : c;
}

function parseCount(q: string | number): number {
  const s = String(q).trim();
  return s === "0" || s === "0.0" || s === "0.00" ? 0 : toPositiveCenti(s);
}

/** Current stock per item and unit, keyed by unitKey(itemId, unit). */
export async function stockLevels(db: Db, companyId: string, itemIds?: string[]): Promise<Map<string, StockLevel>> {
  const [moves, state] = await Promise.all([
    db
      .select({ itemId: stockMovements.itemId, unit: stockMovements.unit, total: sql<string>`sum(${stockMovements.quantity})` })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, companyId), itemIds?.length ? inArray(stockMovements.itemId, itemIds) : undefined))
      .groupBy(stockMovements.itemId, stockMovements.unit),
    loadState(db, companyId),
  ]);
  const out = new Map<string, StockLevel>();
  const get = (itemId: string, unit: string | null) => {
    const k = unitKey(itemId, unit);
    let l = out.get(k);
    if (!l) out.set(k, (l = { itemId, unit, movements: 0, dispatched: 0, inStock: 0 }));
    return l;
  };
  for (const m of moves) get(m.itemId, m.unit).movements += signedCenti(String(m.total));
  for (const d of state.dispatchLines) if (!itemIds || itemIds.includes(d.itemId)) get(d.itemId, d.unit ?? null).dispatched += d.quantity;
  for (const l of out.values()) l.inStock = l.movements - l.dispatched;
  return out;
}

export async function recordStock(db: Db, ctx: Ctx, input: StockEntryInput) {
  if (ctx.role !== "owner" && ctx.role !== "staff") throw new LedgerError("FORBIDDEN", "Viewers cannot change stock");
  assertEntryDate(input.date, ctx.now);
  if (!input.lines.length) throw new LedgerError("NO_LINES", "At least one line is required");
  const raw = input.lines.map((l) => ({
    itemId: l.itemId,
    unit: l.unit ?? null,
    q: input.kind === "receipt" ? toPositiveCenti(l.quantity) : input.kind === "count" ? parseCount(l.quantity) : parseSigned(l.quantity),
  }));

  return db.transaction(async (tx) => {
    await lockCompany(tx, ctx.companyId);
    const firstId = `${input.captureId}-0`;
    const [dup] = await tx
      .select({ batchId: stockMovements.batchId })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, ctx.companyId), eq(stockMovements.captureId, firstId)));
    if (dup) return { batchId: dup.batchId, duplicate: true, lines: [] as { itemId: string; unit: string | null; change: number; before: number; after: number }[] };

    await assertItems(tx, ctx.companyId, raw.map((p) => p.itemId));
    const parsed = await resolveUnits(tx, ctx.companyId, raw);
    const levels = await stockLevels(tx, ctx.companyId, [...new Set(parsed.map((p) => p.itemId))]);
    const running = new Map([...levels].map(([k, v]) => [k, v.inStock]));
    const batchId = randomUUID();
    const lines: { itemId: string; unit: string | null; change: number; before: number; after: number }[] = [];

    for (const [i, p] of parsed.entries()) {
      const k = unitKey(p.itemId, p.unit);
      const before = running.get(k) ?? 0;
      const change = input.kind === "count" ? p.q - before : p.q;
      running.set(k, before + change);
      lines.push({ itemId: p.itemId, unit: p.unit, change, before, after: before + change });
      await tx.insert(stockMovements).values({
        companyId: ctx.companyId,
        batchId,
        captureId: `${input.captureId}-${i}`,
        itemId: p.itemId,
        unit: p.unit,
        kind: input.kind,
        quantity: centiToDecimal(change),
        counted: input.kind === "count" ? centiToDecimal(p.q) : null,
        entryDate: input.date,
        reason: input.reason ?? null,
        channel: input.channel,
        inputMethod: input.inputMethod,
        sourceAttachmentId: input.sourceAttachmentId ?? null,
        sourceText: input.sourceText ?? null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
      });
    }
    await audit(tx, ctx, `stock.${input.kind}`, "stock", batchId, {
      date: input.date,
      reason: input.reason ?? null,
      inputMethod: input.inputMethod,
      lines: lines.map((l) => ({ itemId: l.itemId, unit: l.unit, change: centiToDecimal(l.change), after: centiToDecimal(l.after) })),
    });
    return { batchId, duplicate: false, lines };
  });
}

/** Undo a stock entry (all its lines) with reversal rows. Owners anytime; staff their own, same day. */
export async function reverseStockEntry(db: Db, ctx: Ctx, batchId: string, reason?: string | null) {
  return db.transaction(async (tx) => {
    await lockCompany(tx, ctx.companyId);
    const rows = await tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, ctx.companyId), eq(stockMovements.batchId, batchId)));
    if (!rows.length) throw new LedgerError("NOT_FOUND", "Stock entry not found");
    if (rows.some((r) => r.kind === "reversal")) throw new LedgerError("ALREADY_CANCELLED", "This is itself a reversal");
    const already = await tx
      .select({ id: stockMovements.reversesId })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, ctx.companyId), inArray(stockMovements.reversesId, rows.map((r) => r.id))));
    if (already.length) throw new LedgerError("ALREADY_CANCELLED", "Already reversed");
    const head = rows[0];
    if (!canChange(ctx, head.createdBy, head.createdAt)) {
      throw new LedgerError(ctx.role === "viewer" ? "FORBIDDEN" : head.createdBy !== ctx.userId ? "NOT_OWN_ENTRY" : "EDIT_WINDOW_CLOSED", "Not allowed");
    }
    const revBatch = randomUUID();
    for (const r of rows) {
      await tx.insert(stockMovements).values({
        companyId: ctx.companyId,
        batchId: revBatch,
        captureId: `reverse-${r.id}`,
        itemId: r.itemId,
        unit: r.unit,
        kind: "reversal",
        quantity: centiToDecimal(-signedCenti(r.quantity)),
        entryDate: todayIST(ctx.now),
        reason: reason ?? null,
        reversesId: r.id,
        channel: "app",
        inputMethod: "form",
        createdBy: ctx.userId,
        createdAt: ctx.now,
      });
    }
    await audit(tx, ctx, "stock.reverse", "stock", batchId, { reason: reason ?? null, reversalBatch: revBatch });
    return { batchId: revBatch };
  });
}

const signedCenti = (s: string) => (s.startsWith("-") ? -toCenti(s.slice(1)) : toCenti(s));

export interface StockRow {
  itemId: string;
  /** null = the item's own unit; packing units get their own row. */
  unitCode: string | null;
  name: string;
  product: string;
  variant: string | null;
  unit: string;
  inStock: number;
  owed: number;
  free: number;
  lowLevel: number;
  low: boolean;
}

/**
 * Every item with in stock / owed / free, one row per unit in use (an item
 * with nothing yet shows one row in its own unit). Products stay together.
 */
export async function stockOverview(db: Db, ctx: Ctx): Promise<StockRow[]> {
  const [its, levels, state] = await Promise.all([
    db.select().from(items).where(and(eq(items.companyId, ctx.companyId), eq(items.active, true))),
    stockLevels(db, ctx.companyId),
    loadState(db, ctx.companyId),
  ]);
  const owed = new Map<string, number>();
  for (const l of state.lines) owed.set(unitKey(l.itemId, l.unit), (owed.get(unitKey(l.itemId, l.unit)) ?? 0) + balance(l));
  const rows: StockRow[] = [];
  for (const i of its) {
    const units = new Set<string | null>();
    for (const lv of levels.values()) if (lv.itemId === i.id) units.add(lv.unit);
    for (const k of owed.keys()) if (k.startsWith(`${i.id}|`)) units.add(k.slice(i.id.length + 1) || null);
    if (!units.size) units.add(null);
    const lowLevel = toCenti(i.lowStockLevel);
    for (const u of units) {
      const inStock = levels.get(unitKey(i.id, u))?.inStock ?? 0;
      const o = owed.get(unitKey(i.id, u)) ?? 0;
      rows.push({
        itemId: i.id,
        unitCode: u,
        name: i.name,
        product: i.product ?? i.name,
        variant: i.variant,
        unit: unitLabel(u, i.unit),
        inStock,
        owed: o,
        free: inStock - o,
        lowLevel,
        low: inStock - o <= lowLevel,
      });
    }
  }
  return rows.sort((a, b) => a.product.localeCompare(b.product) || (a.variant ?? "").localeCompare(b.variant ?? "") || (a.unitCode ?? "").localeCompare(b.unitCode ?? ""));
}

export interface StockEvent {
  at: Date;
  unit: string;
  date: string;
  kind: StockEntryKind | "reversal" | "dispatch";
  change: number;
  counted?: number | null;
  reason?: string | null;
  by: string;
  batchId?: string;
  dispatchId?: string;
  partyName?: string;
  reversed?: boolean;
  canReverse?: boolean;
}

/** One item's stock card: numbers plus every movement and dispatch, newest first. */
export async function itemStockHistory(db: Db, ctx: Ctx, itemId: string) {
  const [it] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.companyId, ctx.companyId)));
  if (!it) throw new LedgerError("NOT_FOUND", "Item not found");
  const [rows, us, overview, state] = await Promise.all([
    db.select().from(stockMovements).where(and(eq(stockMovements.companyId, ctx.companyId), eq(stockMovements.itemId, itemId))),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, ctx.companyId)),
    stockOverview(db, ctx),
    loadState(db, ctx.companyId),
  ]);
  const userName = new Map(us.map((u) => [u.id, u.name]));
  const reversedIds = new Set(rows.map((r) => r.reversesId).filter(Boolean));
  const events: StockEvent[] = rows.map((r) => ({
    at: r.createdAt,
    unit: unitLabel(r.unit, it.unit),
    date: r.entryDate,
    kind: r.kind,
    change: signedCenti(r.quantity),
    counted: r.counted ? toCenti(r.counted) : null,
    reason: r.reason,
    by: userName.get(r.createdBy) ?? "?",
    batchId: r.batchId,
    reversed: reversedIds.has(r.id),
    canReverse: r.kind !== "reversal" && !reversedIds.has(r.id) && canChange(ctx, r.createdBy, r.createdAt),
  }));
  const dLines = state.dispatchLines.filter((d) => d.itemId === itemId);
  if (dLines.length) {
    const heads = await db.select().from(dispatches).where(inArray(dispatches.id, [...new Set(dLines.map((d) => d.dispatchId))]));
    const head = new Map(heads.map((h) => [h.id, h]));
    const ps = await db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.companyId, ctx.companyId));
    const partyName = new Map(ps.map((p) => [p.id, p.name]));
    for (const d of dLines) {
      const h = head.get(d.dispatchId)!;
      events.push({ at: d.dispatchCreatedAt, unit: unitLabel(d.unit, it.unit), date: d.dispatchDate, kind: "dispatch", change: -d.quantity, by: userName.get(h.createdBy) ?? "?", dispatchId: d.dispatchId, partyName: partyName.get(d.partyId) });
    }
  }
  events.sort((a, b) => b.date.localeCompare(a.date) || b.at.getTime() - a.at.getTime());
  const unitRows = overview.filter((o) => o.itemId === itemId);
  return { item: unitRows.find((o) => o.unitCode === null) ?? unitRows[0], unitRows, events };
}
