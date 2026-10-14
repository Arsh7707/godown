/**
 * Ledger write/read operations. Every write runs in one transaction holding a
 * per-company advisory lock, so concurrent dispatches cannot over-allocate.
 */
import { and, eq, inArray, max, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import {
  allocations,
  auditLog,
  dispatchLines,
  dispatchRevisions,
  dispatches,
  items,
  orderLineVersions,
  orderLines,
  orderRevisions,
  orders,
  parties,
} from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { assertEntryDate, assertPromisedDate, todayIST } from "@/lib/dates";
import { centiToDecimal, toPositiveCenti } from "@/lib/qty";
import { storedUnit } from "@/lib/units";
import {
  aggregatePending,
  balance,
  planApplyUnmatched,
  planFifo,
  unmatched,
  type LineState,
  type PlannedDispatchLine,
  type PlannedLink,
} from "./domain";
import { currentDispatchRevisions, currentOrderRevisions, loadState } from "./state";

export type Role = "owner" | "staff" | "viewer";
export type Channel = "app" | "whatsapp";
export type InputMethod = "photo" | "voice" | "text" | "form";

export interface Ctx {
  companyId: string;
  userId: string;
  role: Role;
  /** The firm whose items and stock this firm uses (shared godown). Omitted = its own. */
  stockId?: string;
  /** Injectable clock for tests. */
  now?: Date;
}

export interface LineInput {
  itemId: string;
  quantity: string | number;
  /** Packing unit as said (nag, dabba, bora, thaan); omitted/null = the item's own unit. Saved as said. */
  unit?: string | null;
}

interface EntrySource {
  channel: Channel;
  inputMethod: InputMethod;
  sourceAttachmentId?: string | null;
  sourceText?: string | null;
}

// ---------------------------------------------------------------- permissions

/** "correct" here means owner-level correction (e.g. linking unmatched by hand); see authorizeCorrection for entry edits. */
type Action = "read" | "create" | "correct";
const ALLOWED: Record<Action, Role[]> = {
  read: ["owner", "staff", "viewer"],
  create: ["owner", "staff"],
  correct: ["owner"],
};

function authorize(ctx: Ctx, action: Action) {
  if (!ALLOWED[action].includes(ctx.role)) {
    throw new LedgerError("FORBIDDEN", `Role ${ctx.role} cannot ${action}`, { role: ctx.role, action });
  }
}

/** Same rule as authorizeCorrection, for deciding which buttons to show. */
export function canChange(ctx: Ctx, createdBy: string, createdAt: Date): boolean {
  if (ctx.role === "owner") return true;
  if (ctx.role !== "staff") return false;
  return createdBy === ctx.userId && todayIST(createdAt) === todayIST(ctx.now);
}

/**
 * Owners may correct or cancel any entry. Staff may correct or cancel only
 * entries they created themselves, on the same day (IST) they created them.
 */
async function authorizeCorrection(tx: Db, ctx: Ctx, header: typeof orders | typeof dispatches, id: string) {
  if (ctx.role === "owner") return;
  authorize(ctx, "create");
  const [h] = await tx
    .select({ createdBy: header.createdBy, createdAt: header.createdAt })
    .from(header)
    .where(and(eq(header.id, id), eq(header.companyId, ctx.companyId)));
  if (!h) return; // the caller reports NOT_FOUND
  if (h.createdBy !== ctx.userId) {
    throw new LedgerError("NOT_OWN_ENTRY", "Staff can only change entries they made");
  }
  if (todayIST(h.createdAt) !== todayIST(ctx.now)) {
    throw new LedgerError("EDIT_WINDOW_CLOSED", "Staff can only change entries on the day they were made; ask an owner", {
      createdOn: todayIST(h.createdAt),
    });
  }
}

// ---------------------------------------------------------------- helpers

/** Where this firm's items and stock live: its own id, or the firm it shares a godown with. */
export const stockOf = (ctx: Pick<Ctx, "companyId" | "stockId">) => ctx.stockId ?? ctx.companyId;

/** One writer at a time per company, so allocations and stock counts never race. */
export async function lockCompany(tx: Db, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${companyId}))`);
}

/**
 * Lock the firm and, when it shares a godown, the stock firm too. Always in
 * this order (own firm first, stock firm last), so two firms never deadlock.
 */
export async function lockFirm(tx: Db, ctx: Pick<Ctx, "companyId" | "stockId">) {
  await lockCompany(tx, ctx.companyId);
  if (stockOf(ctx) !== ctx.companyId) await lockCompany(tx, stockOf(ctx));
}

export async function audit(tx: Db, ctx: Ctx, action: string, entityType: string, entityId: string, details: unknown) {
  await tx.insert(auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action, entityType, entityId, details });
}

async function assertParty(tx: Db, companyId: string, partyId: string) {
  const [p] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.companyId, companyId), eq(parties.active, true)));
  if (!p) throw new LedgerError("UNKNOWN_PARTY", "Party not found", { partyId });
}

export async function assertItems(tx: Db, companyId: string, itemIds: string[]) {
  const unique = [...new Set(itemIds)];
  const found = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(inArray(items.id, unique), eq(items.companyId, companyId), eq(items.active, true)));
  if (found.length !== unique.length) {
    const ok = new Set(found.map((f) => f.id));
    throw new LedgerError("UNKNOWN_ITEM", "Item not found", { itemIds: unique.filter((i) => !ok.has(i)) });
  }
}

function parseLines(lines: LineInput[]) {
  if (!lines.length) throw new LedgerError("NO_LINES", "At least one line is required");
  return lines.map((l) => ({ itemId: l.itemId, quantity: toPositiveCenti(l.quantity), unit: l.unit ?? null }));
}

/**
 * Stores each line's unit as said: null for the item's own unit, else the
 * packing unit ("dabba"). Rejects units that are neither (e.g. meter for a pcs item).
 */
export async function resolveUnits<L extends { itemId: string; unit?: string | null }>(tx: Db, companyId: string, lines: L[]): Promise<(L & { unit: string | null })[]> {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const its = ids.length ? await tx.select({ id: items.id, unit: items.unit }).from(items).where(and(eq(items.companyId, companyId), inArray(items.id, ids))) : [];
  const unitOf = new Map(its.map((i) => [i.id, i.unit]));
  return lines.map((l) => {
    const base = unitOf.get(l.itemId);
    if (!base) return { ...l, unit: null };
    const u = storedUnit(l.unit, base);
    if (u === undefined) throw new LedgerError("INVALID_UNIT", "Unit not allowed for this item", { unit: l.unit, itemUnit: base });
    return { ...l, unit: u };
  });
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// ---------------------------------------------------------------- orders

export interface CreateOrderInput extends EntrySource {
  captureId: string;
  partyId: string;
  orderDate: string;
  promisedDate?: string | null;
  notes?: string | null;
  lines: LineInput[];
  /** User accepted the offer to apply this party's unmatched dispatches to the new order. */
  applyUnmatched?: boolean;
}

export interface CreateOrderResult {
  orderId: string;
  /** True when this capture id was already saved; nothing new was written. */
  duplicate: boolean;
  appliedUnmatched: PlannedLink[];
}

export async function createOrder(db: Db, ctx: Ctx, input: CreateOrderInput): Promise<CreateOrderResult> {
  authorize(ctx, "create");
  assertEntryDate(input.orderDate, ctx.now);
  if (input.promisedDate) assertPromisedDate(input.promisedDate);
  const parsed = parseLines(input.lines);

  try {
    return await db.transaction(async (tx) => {
      await lockFirm(tx, ctx);

      const [existing] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.companyId, ctx.companyId), eq(orders.captureId, input.captureId)));
      if (existing) return { orderId: existing.id, duplicate: true, appliedUnmatched: [] };

      await assertParty(tx, ctx.companyId, input.partyId);
      await assertItems(
        tx,
        stockOf(ctx),
        parsed.map((l) => l.itemId),
      );
      const lines = await resolveUnits(tx, stockOf(ctx), parsed);

      const [order] = await tx
        .insert(orders)
        .values({ companyId: ctx.companyId, captureId: input.captureId, createdBy: ctx.userId, createdAt: ctx.now })
        .returning();
      const [rev] = await tx
        .insert(orderRevisions)
        .values({
          companyId: ctx.companyId,
          orderId: order.id,
          rev: 1,
          partyId: input.partyId,
          orderDate: input.orderDate,
          promisedDate: input.promisedDate ?? null,
          notes: input.notes ?? null,
          status: "open",
          channel: input.channel,
          inputMethod: input.inputMethod,
          sourceAttachmentId: input.sourceAttachmentId ?? null,
          sourceText: input.sourceText ?? null,
          createdBy: ctx.userId,
        })
        .returning();

      const newLines: LineState[] = [];
      for (const [i, l] of lines.entries()) {
        const [ol] = await tx
          .insert(orderLines)
          .values({ companyId: ctx.companyId, orderId: order.id, lineNo: i + 1 })
          .returning();
        await tx.insert(orderLineVersions).values({
          companyId: ctx.companyId,
          orderRevisionId: rev.id,
          orderLineId: ol.id,
          itemId: l.itemId,
          quantity: centiToDecimal(l.quantity),
          unit: l.unit,
        });
        newLines.push({
          orderLineId: ol.id,
          orderId: order.id,
          lineNo: i + 1,
          partyId: input.partyId,
          itemId: l.itemId,
          unit: l.unit,
          orderDate: input.orderDate,
          promisedDate: input.promisedDate ?? null,
          orderCreatedAt: order.createdAt,
          status: "open",
          ordered: l.quantity,
          dispatched: 0,
        });
      }

      let applied: PlannedLink[] = [];
      if (input.applyUnmatched) {
        const state = await loadState(tx, ctx.companyId, { partyId: input.partyId });
        applied = planApplyUnmatched(state.dispatchLines, newLines);
        await insertLinks(tx, ctx, applied);
      }

      await audit(tx, ctx, "order.create", "order", order.id, {
        partyId: input.partyId,
        orderDate: input.orderDate,
        promisedDate: input.promisedDate ?? null,
        channel: input.channel,
        inputMethod: input.inputMethod,
        lines: lines.map((l) => ({ itemId: l.itemId, unit: l.unit, quantity: centiToDecimal(l.quantity) })),
        appliedUnmatched: applied.map(linkForAudit),
      });
      return { orderId: order.id, duplicate: false, appliedUnmatched: applied };
    });
  } catch (e) {
    // Two requests with the same capture id raced past the existence check.
    if (isUniqueViolation(e)) {
      const [existing] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.companyId, ctx.companyId), eq(orders.captureId, input.captureId)));
      if (existing) return { orderId: existing.id, duplicate: true, appliedUnmatched: [] };
    }
    throw e;
  }
}

/** Unmatched dispatch quantity for a party (optionally only for some items), to offer when a new order is confirmed. */
export async function findUnmatched(db: Db, ctx: Ctx, partyId?: string, itemIds?: string[]) {
  authorize(ctx, "read");
  const state = await loadState(db, ctx.companyId, { partyId });
  return state.dispatchLines
    .filter((d) => unmatched(d) > 0 && (!itemIds || itemIds.includes(d.itemId)))
    .map((d) => ({ ...d, unmatched: unmatched(d) }));
}

export interface CorrectOrderInput {
  /** The revision the user was looking at; rejects the edit if someone else changed the order since. */
  baseRev: number;
  partyId: string;
  orderDate: string;
  promisedDate?: string | null;
  notes?: string | null;
  /** Full desired set of lines. Existing lines carry orderLineId; omitted lines are removed. */
  lines: (LineInput & { orderLineId?: string })[];
  reason?: string | null;
}

export async function correctOrder(db: Db, ctx: Ctx, orderId: string, input: CorrectOrderInput) {
  authorize(ctx, "create");
  assertEntryDate(input.orderDate, ctx.now);
  if (input.promisedDate) assertPromisedDate(input.promisedDate);
  const parsed = input.lines.map((l) => ({ ...parseLines([l])[0], orderLineId: l.orderLineId }));
  if (!parsed.length) throw new LedgerError("NO_LINES", "At least one line is required");

  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    await authorizeCorrection(tx, ctx, orders, orderId);
    const [cur] = await currentOrderRevisions(tx, ctx.companyId, orderId);
    if (!cur) throw new LedgerError("NOT_FOUND", "Order not found", { orderId });
    if (cur.rev !== input.baseRev) throw new LedgerError("STALE_REVISION", "Order was changed by someone else", { currentRev: cur.rev });
    if (cur.status === "cancelled") throw new LedgerError("ALREADY_CANCELLED", "Order is cancelled");

    await assertParty(tx, ctx.companyId, input.partyId);
    await assertItems(
      tx,
      stockOf(ctx),
      parsed.map((l) => l.itemId),
    );
    const lines = await resolveUnits(tx, stockOf(ctx), parsed);

    const { lines: before } = await loadState(tx, ctx.companyId, { orderId });
    const beforeById = new Map(before.map((l) => [l.orderLineId, l]));
    const anyDispatched = before.some((l) => l.dispatched > 0);

    if (input.partyId !== cur.partyId && anyDispatched) {
      throw new LedgerError("PARTY_HAS_DISPATCHES", "Party cannot change after goods were sent");
    }
    const kept = new Set<string>();
    for (const l of lines) {
      if (!l.orderLineId) continue;
      const b = beforeById.get(l.orderLineId);
      if (!b) throw new LedgerError("NOT_FOUND", "Order line not found", { orderLineId: l.orderLineId });
      kept.add(l.orderLineId);
      if (b.dispatched > 0 && (l.itemId !== b.itemId || l.unit !== (b.unit ?? null))) {
        throw new LedgerError("LINE_HAS_DISPATCHES", "Item or unit cannot change after goods were sent", { orderLineId: b.orderLineId });
      }
      if (l.quantity < b.dispatched) {
        throw new LedgerError("BELOW_DISPATCHED", "Quantity cannot be less than already sent", {
          orderLineId: b.orderLineId,
          dispatched: centiToDecimal(b.dispatched),
        });
      }
    }
    for (const b of before) {
      if (!kept.has(b.orderLineId) && b.dispatched > 0) {
        throw new LedgerError("LINE_HAS_DISPATCHES", "A line with sent goods cannot be removed", { orderLineId: b.orderLineId });
      }
    }

    const [rev] = await tx
      .insert(orderRevisions)
      .values({
        companyId: ctx.companyId,
        orderId,
        rev: cur.rev + 1,
        partyId: input.partyId,
        orderDate: input.orderDate,
        promisedDate: input.promisedDate ?? null,
        notes: input.notes ?? null,
        status: "open",
        channel: "app",
        inputMethod: "form",
        sourceAttachmentId: cur.sourceAttachmentId,
        sourceText: cur.sourceText,
        reason: input.reason ?? null,
        createdBy: ctx.userId,
      })
      .returning();

    const [{ maxLine }] = await tx
      .select({ maxLine: max(orderLines.lineNo) })
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId));
    let nextLineNo = (maxLine ?? 0) + 1;
    for (const l of lines) {
      let orderLineId = l.orderLineId;
      if (!orderLineId) {
        const [ol] = await tx
          .insert(orderLines)
          .values({ companyId: ctx.companyId, orderId, lineNo: nextLineNo++ })
          .returning();
        orderLineId = ol.id;
      }
      await tx.insert(orderLineVersions).values({
        companyId: ctx.companyId,
        orderRevisionId: rev.id,
        orderLineId,
        itemId: l.itemId,
        quantity: centiToDecimal(l.quantity),
        unit: l.unit,
      });
    }

    await audit(tx, ctx, "order.correct", "order", orderId, {
      fromRev: cur.rev,
      toRev: rev.rev,
      reason: input.reason ?? null,
      before: {
        partyId: cur.partyId,
        orderDate: cur.orderDate,
        promisedDate: cur.promisedDate,
        lines: before.map((l) => ({ orderLineId: l.orderLineId, itemId: l.itemId, quantity: centiToDecimal(l.ordered) })),
      },
      after: {
        partyId: input.partyId,
        orderDate: input.orderDate,
        promisedDate: input.promisedDate ?? null,
        lines: lines.map((l) => ({ orderLineId: l.orderLineId ?? null, itemId: l.itemId, quantity: centiToDecimal(l.quantity) })),
      },
    });
    return { orderId, rev: rev.rev };
  });
}

/**
 * Cancel an order. Anything already sent stays linked to it; only the
 * remaining balance is cancelled (short-close).
 */
export async function cancelOrder(db: Db, ctx: Ctx, orderId: string, input: { baseRev: number; reason?: string | null }) {
  authorize(ctx, "create");
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    await authorizeCorrection(tx, ctx, orders, orderId);
    const [cur] = await currentOrderRevisions(tx, ctx.companyId, orderId);
    if (!cur) throw new LedgerError("NOT_FOUND", "Order not found", { orderId });
    if (cur.rev !== input.baseRev) throw new LedgerError("STALE_REVISION", "Order was changed by someone else", { currentRev: cur.rev });
    if (cur.status === "cancelled") throw new LedgerError("ALREADY_CANCELLED", "Order is already cancelled");

    const { lines } = await loadState(tx, ctx.companyId, { orderId });
    const { id: _id, rev: _rev, createdAt: _c, ...rest } = cur;
    const [rev] = await tx
      .insert(orderRevisions)
      .values({
        ...rest,
        rev: cur.rev + 1,
        status: "cancelled",
        channel: "app",
        inputMethod: "form",
        reason: input.reason ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    const versions = await tx.select().from(orderLineVersions).where(eq(orderLineVersions.orderRevisionId, cur.id));
    for (const { id: _vid, orderRevisionId: _r, ...v } of versions) {
      await tx.insert(orderLineVersions).values({ ...v, orderRevisionId: rev.id });
    }

    await audit(tx, ctx, "order.cancel", "order", orderId, {
      fromRev: cur.rev,
      toRev: rev.rev,
      reason: input.reason ?? null,
      lines: lines.map((l) => ({
        orderLineId: l.orderLineId,
        ordered: centiToDecimal(l.ordered),
        sent: centiToDecimal(l.dispatched),
        cancelled: centiToDecimal(balance(l)),
      })),
    });
    return { orderId, rev: rev.rev, partyId: cur.partyId };
  });
}

// ---------------------------------------------------------------- dispatches

export interface DispatchFields {
  partyId: string;
  dispatchDate: string;
  takenBy?: string | null;
  transport?: string | null;
  lrNumber?: string | null;
  parcelPhotoId?: string | null;
  notes?: string | null;
  lines: LineInput[];
}

export interface CreateDispatchInput extends DispatchFields, EntrySource {
  captureId: string;
}

export interface DispatchPlan {
  lines: PlannedDispatchLine[];
  totalUnmatched: number;
}

function validateDispatch(ctx: Ctx, input: DispatchFields) {
  assertEntryDate(input.dispatchDate, ctx.now);
  return parseLines(input.lines);
}

/** What a dispatch would allocate if confirmed now. Shown on the confirmation screen; writes nothing. */
export async function previewDispatch(db: Db, ctx: Ctx, input: DispatchFields, opts: { excludeDispatchId?: string } = {}): Promise<DispatchPlan> {
  authorize(ctx, "create");
  const lines = await resolveUnits(db, stockOf(ctx), validateDispatch(ctx, input));
  // When editing a dispatch, preview as if its current version were not there.
  const state = await loadState(db, ctx.companyId, { partyId: input.partyId, excludeDispatchId: opts.excludeDispatchId });
  return toPlan(planFifo(input.partyId, state.lines, lines));
}

function toPlan(lines: PlannedDispatchLine[]): DispatchPlan {
  return { lines, totalUnmatched: lines.reduce((s, l) => s + l.unmatched, 0) };
}

async function writeDispatchRevision(
  tx: Db,
  ctx: Ctx,
  dispatchId: string,
  rev: number,
  input: DispatchFields & EntrySource & { reason?: string | null },
  lines: { itemId: string; quantity: number; unit: string | null }[],
  allocate: boolean,
) {
  const [r] = await tx
    .insert(dispatchRevisions)
    .values({
      companyId: ctx.companyId,
      dispatchId,
      rev,
      partyId: input.partyId,
      dispatchDate: input.dispatchDate,
      takenBy: input.takenBy ?? null,
      transport: input.transport ?? null,
      lrNumber: input.lrNumber ?? null,
      parcelPhotoId: input.parcelPhotoId ?? null,
      notes: input.notes ?? null,
      status: allocate ? "active" : "cancelled",
      channel: input.channel,
      inputMethod: input.inputMethod,
      sourceAttachmentId: input.sourceAttachmentId ?? null,
      sourceText: input.sourceText ?? null,
      reason: input.reason ?? null,
      createdBy: ctx.userId,
    })
    .returning();

  let plan: PlannedDispatchLine[] = [];
  if (allocate) {
    const state = await loadState(tx, ctx.companyId, { partyId: input.partyId, excludeDispatchId: dispatchId });
    plan = planFifo(input.partyId, state.lines, lines);
  }
  for (const [i, l] of lines.entries()) {
    const [dl] = await tx
      .insert(dispatchLines)
      .values({ companyId: ctx.companyId, dispatchRevisionId: r.id, itemId: l.itemId, quantity: centiToDecimal(l.quantity), unit: l.unit })
      .returning();
    for (const a of plan[i]?.allocations ?? []) {
      await tx.insert(allocations).values({
        companyId: ctx.companyId,
        dispatchLineId: dl.id,
        orderLineId: a.orderLineId,
        quantity: centiToDecimal(a.quantity),
        createdBy: ctx.userId,
      });
    }
  }
  return { rev: r, plan: toPlan(plan) };
}

function dispatchForAudit(input: DispatchFields & Partial<EntrySource>, plan: DispatchPlan) {
  return {
    partyId: input.partyId,
    dispatchDate: input.dispatchDate,
    takenBy: input.takenBy ?? null,
    transport: input.transport ?? null,
    lrNumber: input.lrNumber ?? null,
    channel: input.channel,
    inputMethod: input.inputMethod,
    lines: plan.lines.map((l) => ({
      itemId: l.itemId,
      unit: l.unit,
      quantity: centiToDecimal(l.quantity),
      unmatched: centiToDecimal(l.unmatched),
      allocations: l.allocations.map((a) => ({ orderLineId: a.orderLineId, quantity: centiToDecimal(a.quantity) })),
    })),
  };
}

export interface CreateDispatchResult {
  dispatchId: string;
  duplicate: boolean;
  plan: DispatchPlan | null;
}

export async function createDispatch(db: Db, ctx: Ctx, input: CreateDispatchInput): Promise<CreateDispatchResult> {
  authorize(ctx, "create");
  const parsed = validateDispatch(ctx, input);

  try {
    return await db.transaction(async (tx) => {
      await lockFirm(tx, ctx);
      const [existing] = await tx
        .select({ id: dispatches.id })
        .from(dispatches)
        .where(and(eq(dispatches.companyId, ctx.companyId), eq(dispatches.captureId, input.captureId)));
      if (existing) return { dispatchId: existing.id, duplicate: true, plan: null };

      await assertParty(tx, ctx.companyId, input.partyId);
      await assertItems(
        tx,
        stockOf(ctx),
        parsed.map((l) => l.itemId),
      );
      const lines = await resolveUnits(tx, stockOf(ctx), parsed);

      const [d] = await tx
        .insert(dispatches)
        .values({ companyId: ctx.companyId, captureId: input.captureId, createdBy: ctx.userId, createdAt: ctx.now })
        .returning();
      const { plan } = await writeDispatchRevision(tx, ctx, d.id, 1, input, lines, true);
      await audit(tx, ctx, "dispatch.create", "dispatch", d.id, dispatchForAudit(input, plan));
      return { dispatchId: d.id, duplicate: false, plan };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const [existing] = await db
        .select({ id: dispatches.id })
        .from(dispatches)
        .where(and(eq(dispatches.companyId, ctx.companyId), eq(dispatches.captureId, input.captureId)));
      if (existing) return { dispatchId: existing.id, duplicate: true, plan: null };
    }
    throw e;
  }
}

/** Correct a dispatch: writes a new revision and re-runs FIFO for it. */
export async function correctDispatch(
  db: Db,
  ctx: Ctx,
  dispatchId: string,
  input: DispatchFields & { baseRev: number; reason?: string | null },
) {
  authorize(ctx, "create");
  const parsed = validateDispatch(ctx, input);
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    await authorizeCorrection(tx, ctx, dispatches, dispatchId);
    const [cur] = await currentDispatchRevisions(tx, ctx.companyId, dispatchId);
    if (!cur) throw new LedgerError("NOT_FOUND", "Dispatch not found", { dispatchId });
    if (cur.rev !== input.baseRev) throw new LedgerError("STALE_REVISION", "Dispatch was changed by someone else", { currentRev: cur.rev });
    if (cur.status === "cancelled") throw new LedgerError("ALREADY_CANCELLED", "Dispatch is cancelled");
    await assertParty(tx, ctx.companyId, input.partyId);
    await assertItems(
      tx,
      stockOf(ctx),
      parsed.map((l) => l.itemId),
    );
    const lines = await resolveUnits(tx, stockOf(ctx), parsed);

    const source = { channel: "app", inputMethod: "form", sourceAttachmentId: cur.sourceAttachmentId, sourceText: cur.sourceText } as const;
    const { rev, plan } = await writeDispatchRevision(tx, ctx, dispatchId, cur.rev + 1, { ...input, ...source }, lines, true);
    await audit(tx, ctx, "dispatch.correct", "dispatch", dispatchId, {
      fromRev: cur.rev,
      toRev: rev.rev,
      reason: input.reason ?? null,
      before: { partyId: cur.partyId, dispatchDate: cur.dispatchDate, takenBy: cur.takenBy, transport: cur.transport, lrNumber: cur.lrNumber },
      after: dispatchForAudit({ ...input, ...source }, plan),
    });
    return { dispatchId, rev: rev.rev, plan };
  });
}

/** Cancel a dispatch: its quantities stop counting and the orders' balances reopen. */
export async function cancelDispatch(db: Db, ctx: Ctx, dispatchId: string, input: { baseRev: number; reason?: string | null }) {
  authorize(ctx, "create");
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    await authorizeCorrection(tx, ctx, dispatches, dispatchId);
    const [cur] = await currentDispatchRevisions(tx, ctx.companyId, dispatchId);
    if (!cur) throw new LedgerError("NOT_FOUND", "Dispatch not found", { dispatchId });
    if (cur.rev !== input.baseRev) throw new LedgerError("STALE_REVISION", "Dispatch was changed by someone else", { currentRev: cur.rev });
    if (cur.status === "cancelled") throw new LedgerError("ALREADY_CANCELLED", "Dispatch is already cancelled");

    const curLines = await tx.select().from(dispatchLines).where(eq(dispatchLines.dispatchRevisionId, cur.id));
    const lines = curLines.map((l) => ({ itemId: l.itemId, quantity: toPositiveCenti(l.quantity), unit: l.unit }));
    const { rev } = await writeDispatchRevision(
      tx,
      ctx,
      dispatchId,
      cur.rev + 1,
      {
        ...cur,
        lines: [],
        channel: "app",
        inputMethod: "form",
        reason: input.reason ?? null,
      },
      lines,
      false,
    );
    await audit(tx, ctx, "dispatch.cancel", "dispatch", dispatchId, { fromRev: cur.rev, toRev: rev.rev, reason: input.reason ?? null });
    return { dispatchId, rev: rev.rev, partyId: cur.partyId };
  });
}

// ---------------------------------------------------------------- linking unmatched

async function insertLinks(tx: Db, ctx: Ctx, links: PlannedLink[]) {
  for (const l of links) {
    await tx.insert(allocations).values({
      companyId: ctx.companyId,
      dispatchLineId: l.dispatchLineId,
      orderLineId: l.orderLineId,
      quantity: centiToDecimal(l.quantity),
      createdBy: ctx.userId,
    });
  }
}

function linkForAudit(l: PlannedLink) {
  return { dispatchLineId: l.dispatchLineId, orderLineId: l.orderLineId, quantity: centiToDecimal(l.quantity) };
}

/** Owner links part of an unmatched dispatch line to an open order line by hand. */
export async function linkUnmatched(
  db: Db,
  ctx: Ctx,
  input: { dispatchLineId: string; orderLineId: string; quantity: string | number },
) {
  authorize(ctx, "correct");
  const qty = toPositiveCenti(input.quantity);
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    const state = await loadState(tx, ctx.companyId);
    const d = state.dispatchLines.find((x) => x.dispatchLineId === input.dispatchLineId);
    const o = state.lines.find((x) => x.orderLineId === input.orderLineId);
    if (!d) throw new LedgerError("NOT_FOUND", "Dispatch line not found or not current");
    if (!o) throw new LedgerError("NOT_FOUND", "Order line not found or not current");
    if (d.partyId !== o.partyId || d.itemId !== o.itemId || (d.unit ?? null) !== (o.unit ?? null)) {
      throw new LedgerError("LINK_MISMATCH", "Party and item must match");
    }
    if (qty > unmatched(d) || qty > balance(o)) {
      throw new LedgerError("LINK_EXCEEDS", "More than the unmatched quantity or the order balance", {
        unmatched: centiToDecimal(unmatched(d)),
        balance: centiToDecimal(balance(o)),
      });
    }
    const link = { dispatchLineId: d.dispatchLineId, orderLineId: o.orderLineId, quantity: qty };
    await insertLinks(tx, ctx, [link]);
    await audit(tx, ctx, "dispatch.link", "dispatch", d.dispatchId, linkForAudit(link));
    return link;
  });
}

// ---------------------------------------------------------------- reads

export async function getPending(db: Db, ctx: Ctx, filter: { partyId?: string } = {}) {
  authorize(ctx, "read");
  const today = todayIST(ctx.now);
  const { lines } = await loadState(db, ctx.companyId, filter);
  return {
    today,
    lines,
    byParty: aggregatePending(lines, (l) => l.partyId, today),
    byItem: aggregatePending(lines, (l) => l.itemId, today),
  };
}
