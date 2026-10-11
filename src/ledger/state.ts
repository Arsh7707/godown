/**
 * Loads current ledger state from the append-only tables into the pure
 * domain shapes. "Current" = highest revision of each order / dispatch.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import {
  allocations,
  dispatchLines,
  dispatchRevisions,
  dispatches,
  orderLineVersions,
  orderLines,
  orderRevisions,
  orders,
} from "@/db/schema";
import { toCenti } from "@/lib/qty";
import type { DispatchLineState, LineState } from "./domain";

export interface LedgerState {
  lines: LineState[];
  dispatchLines: DispatchLineState[];
}

export interface StateFilter {
  partyId?: string;
  orderId?: string;
  /** Treat this dispatch as if its current revision did not exist (used when correcting it). */
  excludeDispatchId?: string;
}

export async function currentOrderRevisions(db: Db, companyId: string, orderId?: string) {
  return db
    .selectDistinctOn([orderRevisions.orderId])
    .from(orderRevisions)
    .where(and(eq(orderRevisions.companyId, companyId), orderId ? eq(orderRevisions.orderId, orderId) : undefined))
    .orderBy(orderRevisions.orderId, desc(orderRevisions.rev));
}

export async function currentDispatchRevisions(db: Db, companyId: string, dispatchId?: string) {
  return db
    .selectDistinctOn([dispatchRevisions.dispatchId])
    .from(dispatchRevisions)
    .where(
      and(eq(dispatchRevisions.companyId, companyId), dispatchId ? eq(dispatchRevisions.dispatchId, dispatchId) : undefined),
    )
    .orderBy(dispatchRevisions.dispatchId, desc(dispatchRevisions.rev));
}

export async function loadState(db: Db, companyId: string, filter: StateFilter = {}): Promise<LedgerState> {
  // Orders
  let orderRevs = await currentOrderRevisions(db, companyId, filter.orderId);
  if (filter.partyId) orderRevs = orderRevs.filter((r) => r.partyId === filter.partyId);

  const lineRows = orderRevs.length
    ? await db
        .select({
          orderLineId: orderLines.id,
          orderId: orderLines.orderId,
          lineNo: orderLines.lineNo,
          itemId: orderLineVersions.itemId,
          unit: orderLineVersions.unit,
          quantity: orderLineVersions.quantity,
          orderRevisionId: orderLineVersions.orderRevisionId,
          orderCreatedAt: orders.createdAt,
        })
        .from(orderLineVersions)
        .innerJoin(orderLines, eq(orderLines.id, orderLineVersions.orderLineId))
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(
          and(
            eq(orderLineVersions.companyId, companyId),
            inArray(
              orderLineVersions.orderRevisionId,
              orderRevs.map((r) => r.id),
            ),
          ),
        )
    : [];

  // Dispatches: only current, active revisions count.
  let dispRevs = (await currentDispatchRevisions(db, companyId)).filter(
    (r) => r.status === "active" && r.dispatchId !== filter.excludeDispatchId,
  );
  if (filter.partyId) dispRevs = dispRevs.filter((r) => r.partyId === filter.partyId);

  const dLineRows = dispRevs.length
    ? await db
        .select({
          id: dispatchLines.id,
          dispatchRevisionId: dispatchLines.dispatchRevisionId,
          itemId: dispatchLines.itemId,
          unit: dispatchLines.unit,
          quantity: dispatchLines.quantity,
          dispatchCreatedAt: dispatches.createdAt,
        })
        .from(dispatchLines)
        .innerJoin(dispatchRevisions, eq(dispatchRevisions.id, dispatchLines.dispatchRevisionId))
        .innerJoin(dispatches, eq(dispatches.id, dispatchRevisions.dispatchId))
        .where(
          and(
            eq(dispatchLines.companyId, companyId),
            inArray(
              dispatchLines.dispatchRevisionId,
              dispRevs.map((r) => r.id),
            ),
          ),
        )
    : [];

  const allocRows = dLineRows.length
    ? await db
        .select({
          dispatchLineId: allocations.dispatchLineId,
          orderLineId: allocations.orderLineId,
          quantity: sql<string>`sum(${allocations.quantity})`,
        })
        .from(allocations)
        .where(
          and(
            eq(allocations.companyId, companyId),
            inArray(
              allocations.dispatchLineId,
              dLineRows.map((d) => d.id),
            ),
          ),
        )
        .groupBy(allocations.dispatchLineId, allocations.orderLineId)
    : [];

  const dispatchedByLine = new Map<string, number>();
  const allocatedByDLine = new Map<string, number>();
  for (const a of allocRows) {
    const q = toCenti(a.quantity);
    dispatchedByLine.set(a.orderLineId, (dispatchedByLine.get(a.orderLineId) ?? 0) + q);
    allocatedByDLine.set(a.dispatchLineId, (allocatedByDLine.get(a.dispatchLineId) ?? 0) + q);
  }

  const revById = new Map(orderRevs.map((r) => [r.id, r]));
  const lines: LineState[] = lineRows.map((l) => {
    const r = revById.get(l.orderRevisionId)!;
    return {
      orderLineId: l.orderLineId,
      orderId: l.orderId,
      lineNo: l.lineNo,
      partyId: r.partyId,
      itemId: l.itemId,
      unit: l.unit,
      orderDate: r.orderDate,
      promisedDate: r.promisedDate,
      orderCreatedAt: l.orderCreatedAt,
      status: r.status,
      ordered: toCenti(l.quantity),
      dispatched: dispatchedByLine.get(l.orderLineId) ?? 0,
    };
  });

  const dRevById = new Map(dispRevs.map((r) => [r.id, r]));
  const dLines: DispatchLineState[] = dLineRows.map((d) => {
    const r = dRevById.get(d.dispatchRevisionId)!;
    return {
      dispatchLineId: d.id,
      dispatchId: r.dispatchId,
      partyId: r.partyId,
      itemId: d.itemId,
      unit: d.unit,
      dispatchDate: r.dispatchDate,
      dispatchCreatedAt: d.dispatchCreatedAt,
      quantity: toCenti(d.quantity),
      allocated: allocatedByDLine.get(d.id) ?? 0,
    };
  });

  return { lines, dispatchLines: dLines };
}
