/**
 * What the reminders say and when they fire.
 *
 * - Morning digest (owners, once a day): overdue orders and dispatches that
 *   didn't match any order. Nothing to report = no notification.
 * - Low stock (owners, instant): an item's free stock crosses to or below its
 *   low level. Fires once per crossing; it re-arms when stock recovers.
 * - Over stock (owners, instant): a dispatch leaves an item with less than
 *   zero in stock, i.e. someone pressed "Send anyway".
 * - Staff activity (owners, instant): a staff member created, changed or
 *   cancelled an entry, or added a client / item.
 * - Stock keeper (11 AM): "maal add kiya?" unless goods in was entered today.
 * The person who made the entry isn't alerted about their own entry.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { companies, items, parties, stockAlertState, stockMovements, users } from "@/db/schema";
import { daysOld, isOverdue, unmatched } from "@/ledger/domain";
import { loadState } from "@/ledger/state";
import { stockLevels, stockOverview, type StockRow } from "@/stock/service";
import { todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/qty";
import { unitKey, unitLabel } from "@/lib/units";
import { pushText, type StaffAction } from "./text";
import { notifyUsers, ownerIds, poolOwnerIds, type PushSender } from "./push";

const LIST = 3;

function listWithMore(names: string[], more: (n: number) => string): string {
  const shown = names.slice(0, LIST).join(", ");
  return names.length > LIST ? `${shown} ${more(names.length - LIST)}` : shown;
}

export interface Digest {
  overdue: { partyName: string; orders: number; oldestDays: number }[];
  overdueOrders: number;
  unmatchedDispatches: number;
}

export async function buildDigest(db: Db, companyId: string, today: string): Promise<Digest | null> {
  const state = await loadState(db, companyId);
  const byParty = new Map<string, { orders: Set<string>; oldestDays: number }>();
  for (const l of state.lines) {
    if (!isOverdue(l, today)) continue;
    const p = byParty.get(l.partyId) ?? { orders: new Set(), oldestDays: 0 };
    p.orders.add(l.orderId);
    p.oldestDays = Math.max(p.oldestDays, daysOld(l, today));
    byParty.set(l.partyId, p);
  }
  const unmatchedDispatches = new Set(state.dispatchLines.filter((d) => unmatched(d) > 0).map((d) => d.dispatchId)).size;
  if (!byParty.size && !unmatchedDispatches) return null;

  const names = byParty.size
    ? new Map(
        (await db.select({ id: parties.id, name: parties.name }).from(parties).where(inArray(parties.id, [...byParty.keys()]))).map((p) => [p.id, p.name]),
      )
    : new Map<string, string>();
  const overdue = [...byParty]
    .map(([id, p]) => ({ partyName: names.get(id) ?? "?", orders: p.orders.size, oldestDays: p.oldestDays }))
    .sort((a, b) => b.oldestDays - a.oldestDays || a.partyName.localeCompare(b.partyName));
  return { overdue, overdueOrders: overdue.reduce((s, p) => s + p.orders, 0), unmatchedDispatches };
}

export function digestMessage(d: Digest, lang: "hi" | "en") {
  const t = pushText(lang);
  const parts: string[] = [];
  if (d.overdueOrders) {
    parts.push(`${t.overdueTitle(d.overdueOrders)}: ${listWithMore(d.overdue.map((p) => `${p.partyName} (${t.days(p.oldestDays)})`), t.more)}`);
  }
  if (d.unmatchedDispatches) parts.push(t.unmatched(d.unmatchedDispatches));
  return { title: t.morningTitle, body: parts.join("\n"), url: d.overdueOrders ? "/pending" : "/dispatches", tag: "digest" };
}

/** The 9 AM run: one digest per company, to its owners. */
export async function sendMorningDigests(db: Db, send: PushSender, now = new Date()) {
  const today = todayIST(now);
  let sent = 0;
  for (const c of await db.select({ id: companies.id }).from(companies)) {
    const owners = await ownerIds(db, c.id);
    if (!owners.length) continue;
    const d = await buildDigest(db, c.id, today);
    if (d) sent += await notifyUsers(db, send, owners, (u) => digestMessage(d, u.language));
  }
  return sent;
}

/**
 * Compare each item's low/OK state with the last one seen and alert on new lows.
 * The first run for a company only records the current state (no flood of
 * alerts for items that were never stocked).
 */
export async function checkLowStock(db: Db, send: PushSender | null, stockId: string, actorId: string) {
  // State is kept per godown: firms sharing one see the same stock.
  const companyId = stockId;
  const rows = await stockOverview(db, { companyId, userId: actorId, role: "owner" });
  const known = new Map(
    (await db.select({ key: stockAlertState.key, low: stockAlertState.low }).from(stockAlertState).where(eq(stockAlertState.companyId, companyId))).map((r) => [r.key, r.low]),
  );
  const firstRun = known.size === 0;
  const newlyLow: StockRow[] = [];
  for (const r of rows) {
    const key = unitKey(r.itemId, r.unitCode);
    const was = known.get(key);
    if (was === r.low) continue;
    if (was === undefined || firstRun) {
      await db.insert(stockAlertState).values({ companyId, key, low: r.low }).onConflictDoNothing();
      continue;
    }
    // Only one concurrent save wins the flip, so the alert goes out once.
    const flipped = await db
      .update(stockAlertState)
      .set({ low: r.low, updatedAt: new Date() })
      .where(and(eq(stockAlertState.companyId, companyId), eq(stockAlertState.key, key), eq(stockAlertState.low, !r.low)))
      .returning({ key: stockAlertState.key });
    if (flipped.length && r.low) newlyLow.push(r);
  }
  if (!newlyLow.length || !send) return newlyLow;
  const [actor] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, actorId));
  const owners = await poolOwnerIds(db, stockId, actor?.phone);
  await notifyUsers(db, send, owners, (u) => {
    const t = pushText(u.language);
    return {
      title: t.lowTitle,
      body: listWithMore(newlyLow.map((r) => `${r.name}: ${formatQty(r.free)} ${r.unit} ${t.freeLeft}`), t.more),
      url: newlyLow.length === 1 ? `/stock/item/${newlyLow[0].itemId}` : "/stock",
      tag: "low-stock",
    };
  });
  return newlyLow;
}

/**
 * After a dispatch: alert owners for lines that left stock below zero.
 * `increasedKeys` limits a correction to lines that now send more than before.
 */
export async function checkOverStock(
  db: Db,
  send: PushSender | null,
  ctx: { companyId: string; stockId?: string; actorId: string; actorName: string; partyId: string },
  lines: { itemId: string; unit?: string | null }[],
  increasedKeys?: Set<string>,
) {
  const keys = new Map(lines.map((l) => [unitKey(l.itemId, l.unit ?? null), l]));
  for (const k of keys.keys()) if (increasedKeys && !increasedKeys.has(k)) keys.delete(k);
  if (!keys.size) return [];
  const levels = await stockLevels(db, ctx.stockId ?? ctx.companyId, [...new Set([...keys.values()].map((l) => l.itemId))]);
  const short = [...keys].map(([k, l]) => ({ ...l, inStock: levels.get(k)?.inStock ?? 0 })).filter((l) => l.inStock < 0);
  if (!short.length || !send) return short;

  const [its, [party]] = await Promise.all([
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(inArray(items.id, short.map((s) => s.itemId))),
    db.select({ name: parties.name }).from(parties).where(eq(parties.id, ctx.partyId)),
  ]);
  const item = new Map(its.map((i) => [i.id, i]));
  const owners = await ownerIds(db, ctx.companyId, ctx.actorId);
  await notifyUsers(db, send, owners, (u) => {
    const t = pushText(u.language);
    const what = short.map((s) => `${item.get(s.itemId)?.name}: ${formatQty(-s.inStock)} ${unitLabel(s.unit ?? null, item.get(s.itemId)?.unit ?? "")} ${t.short}`);
    return {
      title: t.overTitle,
      body: `${listWithMore(what, t.more)}\n${t.sentBy(party?.name ?? "?", ctx.actorName)}`,
      url: "/stock",
      tag: `over-${Date.now()}`,
    };
  });
  return short;
}


export interface StaffEvent {
  action: StaffAction;
  /** Client the entry is for, when there is one. */
  partyId?: string | null;
  /** Lines as entered (for create / edit). */
  lines?: { itemId: string; quantity: string | number; unit?: string | null }[];
  /** For new clients / items: the name. */
  name?: string;
  url: string;
}

/** A staff member created, changed or cancelled something: tell the owners right away. */
export async function notifyStaffActivity(db: Db, send: PushSender | null, actor: { companyId: string; userId: string; name: string; role: string }, ev: StaffEvent) {
  if (actor.role !== "staff" || !send) return 0;
  const itemIds = [...new Set((ev.lines ?? []).map((l) => l.itemId))];
  const [its, party] = await Promise.all([
    itemIds.length ? db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(inArray(items.id, itemIds)) : Promise.resolve([]),
    ev.partyId ? db.select({ name: parties.name }).from(parties).where(eq(parties.id, ev.partyId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const item = new Map(its.map((i) => [i.id, i]));
  const what = (ev.lines ?? []).map((l) => {
    const i = item.get(l.itemId);
    return `${i?.name ?? "?"} ${String(l.quantity).trim()} ${unitLabel(l.unit ?? null, i?.unit ?? "")}`;
  });
  const owners = await ownerIds(db, actor.companyId, actor.userId);
  return notifyUsers(db, send, owners, (u) => {
    const t = pushText(u.language);
    const head = [party?.name ?? ev.name, listWithMore(what, t.more)].filter(Boolean).join(": ");
    return { title: `${actor.name} · ${t.act[ev.action]}`, body: head, url: ev.url, tag: `staff-${ev.action}-${Date.now()}` };
  });
}

/**
 * 11 AM: remind each stock keeper to enter goods in, unless someone in the
 * company already entered goods in today (IST).
 */
export async function sendStockKeeperReminders(db: Db, send: PushSender, now = new Date()) {
  const today = todayIST(now);
  let sent = 0;
  for (const c of await db.select({ id: companies.id, stockCompanyId: companies.stockCompanyId }).from(companies)) {
    const keepers = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, c.id), eq(users.stockKeeper, true), eq(users.active, true)))
    ).map((u) => u.id);
    if (!keepers.length) continue;
    // A shared godown: goods in entered from any of its firms counts.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.companyId, c.stockCompanyId ?? c.id),
          eq(stockMovements.kind, "receipt"),
          sql`(${stockMovements.createdAt} at time zone 'Asia/Kolkata')::date = ${today}::date`,
        ),
      );
    if (n > 0) continue;
    sent += await notifyUsers(db, send, keepers, (u) => {
      const t = pushText(u.language);
      return { title: t.stockTitle, body: t.stockBody, url: "/stock/in", tag: "stock-keeper" };
    });
  }
  return sent;
}
