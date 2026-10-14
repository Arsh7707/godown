/**
 * Activity log: who did what, when, from the audit log. Owners only.
 *
 * Each audit row is turned into something readable: the action, the client /
 * item / person it is about, the lines (item, quantity, unit) and, for
 * changes, before → after. Names are looked up now; something deleted since
 * shows the name the log kept, or "—". A full Aadhaar number is never in the
 * log, so nothing here can show one.
 */
import { and, desc, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, dispatchLines, dispatchRevisions, items, orderLineVersions, orderRevisions, parties, users } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { addDays, isValidDate } from "@/lib/dates";
import { formatQty, toCenti } from "@/lib/qty";
import { unitLabel } from "@/lib/units";
import { stockOf, type Ctx } from "./service";

export const ACTIVITY_GROUPS = {
  orders: ["order."],
  dispatches: ["dispatch."],
  stock: ["stock."],
  clients: ["party."],
  items: ["item.", "product."],
  settings: ["user.", "company.", "firm."],
  imports: ["import."],
} as const;
export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;

export interface ActivityChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface ActivityEntry {
  id: string;
  at: Date;
  by: string;
  byId: string;
  action: string;
  /** Client / item / person / firm the entry is about. */
  subject: string | null;
  /** "D-4012 10 pcs" */
  lines: string[];
  changes: ActivityChange[];
  reason: string | null;
  /** Excel imports: how many were added and updated. */
  counts?: { created: number; updated: number };
  /** Date the entry was for, when it isn't the day it was made. */
  forDate: string | null;
  href: string | null;
}

export interface ActivityFilter {
  userId?: string;
  group?: ActivityGroup;
  /** IST days, inclusive. */
  from?: string;
  to?: string;
  /** Continue after this entry (older ones). */
  before?: { at: string; id: string };
  limit?: number;
}

const PAGE = 50;
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
/** "12.50" / "-3.00" from the log → "12.5" / "−3". */
function qty(q: unknown): string {
  if (q === null || q === undefined) return "?";
  const s = String(q);
  const neg = s.startsWith("-");
  try {
    return `${neg ? "−" : ""}${formatQty(toCenti(neg ? s.slice(1) : s))}`;
  } catch {
    return s;
  }
}

type D = Record<string, unknown>;
type LineD = { itemId?: string; unit?: string | null; quantity?: unknown; change?: unknown; after?: unknown; cancelled?: unknown; orderLineId?: string };

export async function activityLog(db: Db, ctx: Ctx, f: ActivityFilter = {}): Promise<{ entries: ActivityEntry[]; more: boolean }> {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can see the activity log");
  const limit = Math.min(Math.max(f.limit ?? PAGE, 1), 200);
  const conds: SQL[] = [eq(auditLog.companyId, ctx.companyId)];
  if (f.userId) conds.push(eq(auditLog.userId, f.userId));
  if (f.group) conds.push(or(...ACTIVITY_GROUPS[f.group].map((p) => like(auditLog.action, `${p}%`)))!);
  if (f.from) {
    if (!isValidDate(f.from)) throw new LedgerError("INVALID_DATE", "Bad date");
    conds.push(gte(auditLog.createdAt, istStart(f.from)));
  }
  if (f.to) {
    if (!isValidDate(f.to)) throw new LedgerError("INVALID_DATE", "Bad date");
    conds.push(lt(auditLog.createdAt, istStart(addDays(f.to, 1))));
  }
  if (f.before) {
    const at = new Date(f.before.at);
    if (isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(f.before.id)) throw new LedgerError("INVALID_DATE", "Bad cursor");
    conds.push(sql`(${auditLog.createdAt}, ${auditLog.id}) < (${at.toISOString()}::timestamptz, ${f.before.id}::uuid)`);
  }
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!page.length) return { entries: [], more: false };

  // ---- names
  const partyIds = new Set<string>();
  const itemIds = new Set<string>();
  const orderIds = new Set<string>();
  const dispatchIds = new Set<string>();
  const orderLineIds = new Set<string>();
  const dispatchLineIds = new Set<string>();
  const userIds = new Set<string>(page.map((r) => r.userId));
  for (const r of page) {
    const d = r.details as D;
    const add = (set: Set<string>, v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) && set.add(v);
    if (r.entityType === "party") add(partyIds, r.entityId);
    if (r.entityType === "item") add(itemIds, r.entityId);
    if (r.entityType === "order") add(orderIds, r.entityId);
    if (r.entityType === "dispatch") add(dispatchIds, r.entityId);
    if (r.entityType === "user") add(userIds, r.entityId);
    for (const x of [d, d.before as D, d.after as D]) if (x && typeof x === "object") add(partyIds, x.partyId);
    add(itemIds, d.itemId);
    add(dispatchLineIds, d.dispatchLineId);
    if (r.entityType === "dispatch_line") add(dispatchLineIds, r.entityId);
    add(dispatchIds, d.dispatchId);
    const lineLists = [d.lines, (d.before as D)?.lines, (d.after as D)?.lines].filter(Array.isArray) as LineD[][];
    for (const ls of lineLists) for (const l of ls) {
      add(itemIds, l.itemId);
      add(orderLineIds, l.orderLineId);
    }
  }
  const [oRevs, dRevs, olv, dls] = await Promise.all([
    orderIds.size ? db.select({ orderId: orderRevisions.orderId, rev: orderRevisions.rev, partyId: orderRevisions.partyId }).from(orderRevisions).where(and(eq(orderRevisions.companyId, ctx.companyId), inArray(orderRevisions.orderId, [...orderIds]))) : [],
    dispatchIds.size ? db.select({ dispatchId: dispatchRevisions.dispatchId, rev: dispatchRevisions.rev, partyId: dispatchRevisions.partyId }).from(dispatchRevisions).where(and(eq(dispatchRevisions.companyId, ctx.companyId), inArray(dispatchRevisions.dispatchId, [...dispatchIds]))) : [],
    orderLineIds.size ? db.select({ orderLineId: orderLineVersions.orderLineId, itemId: orderLineVersions.itemId, unit: orderLineVersions.unit }).from(orderLineVersions).where(and(eq(orderLineVersions.companyId, ctx.companyId), inArray(orderLineVersions.orderLineId, [...orderLineIds]))) : [],
    dispatchLineIds.size ? db.select({ id: dispatchLines.id, itemId: dispatchLines.itemId, unit: dispatchLines.unit }).from(dispatchLines).where(and(eq(dispatchLines.companyId, ctx.companyId), inArray(dispatchLines.id, [...dispatchLineIds]))) : [],
  ]);
  const latest = <T extends { rev: number; partyId: string }>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T>();
    for (const r of rows) if (!m.has(key(r)) || m.get(key(r))!.rev < r.rev) m.set(key(r), r);
    return new Map([...m].map(([k, v]) => [k, v.partyId]));
  };
  const orderParty = latest(oRevs, (r) => r.orderId);
  const dispatchParty = latest(dRevs, (r) => r.dispatchId);
  for (const p of [...orderParty.values(), ...dispatchParty.values()]) partyIds.add(p);
  const lineItem = new Map(olv.map((l) => [l.orderLineId, l]));
  const dLine = new Map(dls.map((l) => [l.id, l]));
  for (const l of [...olv, ...dls]) itemIds.add(l.itemId);
  const [ps, its, us] = await Promise.all([
    partyIds.size ? db.select({ id: parties.id, name: parties.name }).from(parties).where(and(eq(parties.companyId, ctx.companyId), inArray(parties.id, [...partyIds]))) : [],
    itemIds.size ? db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(and(inArray(items.companyId, [ctx.companyId, stockOf(ctx)]), inArray(items.id, [...itemIds]))) : [],
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.companyId, ctx.companyId), inArray(users.id, [...userIds]))),
  ]);
  const partyName = new Map(ps.map((p) => [p.id, p.name]));
  const item = new Map(its.map((i) => [i.id, i]));
  const userName = new Map(us.map((u) => [u.id, u.name]));
  const itemText = (id: unknown, unit: unknown, q: string) => {
    const it = typeof id === "string" ? item.get(id) : undefined;
    return `${it?.name ?? "—"} ${q} ${unitLabel((unit as string | null) ?? null, it?.unit ?? "")}`.trim();
  };
  const linesOf = (ls: unknown, pick: (l: LineD) => unknown = (l) => l.quantity) => (Array.isArray(ls) ? (ls as LineD[]).map((l) => itemText(l.itemId, l.unit, qty(pick(l)))) : []);

  /** Before → after for plain fields (names, phones, levels, roles…). */
  const diff = (before: D | undefined, after: D | undefined, skip: string[] = []): ActivityChange[] => {
    if (!after || typeof after !== "object") return [];
    const out: ActivityChange[] = [];
    for (const [k, v] of Object.entries(after)) {
      if (v === undefined || skip.includes(k) || k === "lines") continue;
      const b = before?.[k];
      if (str(b) === str(v)) continue;
      out.push({ field: k, from: k === "partyId" ? (partyName.get(b as string) ?? str(b)) : str(b), to: k === "partyId" ? (partyName.get(v as string) ?? str(v)) : str(v) });
    }
    return out;
  };
  /** Order/dispatch lines: which items changed quantity, were added or removed. */
  const lineDiff = (before: unknown, after: unknown): ActivityChange[] => {
    const sum = (ls: unknown) => {
      const m = new Map<string, { itemId: string; unit: unknown; q: number }>();
      for (const l of (Array.isArray(ls) ? ls : []) as LineD[]) {
        const k = `${l.itemId}|${l.unit ?? ""}`;
        let c = 0;
        try {
          c = toCenti(String(l.quantity));
        } catch {}
        const cur = m.get(k) ?? { itemId: l.itemId ?? "", unit: l.unit ?? null, q: 0 };
        cur.q += c;
        m.set(k, cur);
      }
      return m;
    };
    const b = sum(before);
    const a = sum(after);
    const out: ActivityChange[] = [];
    for (const k of new Set([...b.keys(), ...a.keys()])) {
      const x = b.get(k);
      const y = a.get(k);
      if (x?.q === y?.q) continue;
      const any = (y ?? x)!;
      const it = item.get(any.itemId);
      const u = unitLabel((any.unit as string | null) ?? null, it?.unit ?? "");
      out.push({ field: it?.name ?? "—", from: x ? `${formatQty(x.q)} ${u}` : null, to: y ? `${formatQty(y.q)} ${u}` : null });
    }
    return out;
  };

  const entries = page.map((r): ActivityEntry => {
    const d = (r.details ?? {}) as D;
    const before = d.before as D | undefined;
    const after = d.after as D | undefined;
    const e: ActivityEntry = {
      id: r.id,
      at: r.createdAt,
      by: userName.get(r.userId) ?? "—",
      byId: r.userId,
      action: r.action,
      subject: null,
      lines: [],
      changes: [],
      reason: str(d.reason),
      forDate: null,
      href: null,
    };
    const [kind] = r.action.split(".");
    if (kind === "order") {
      e.subject = partyName.get(orderParty.get(r.entityId) ?? (d.partyId as string)) ?? "—";
      e.href = `/orders/${r.entityId}`;
      if (r.action === "order.create") {
        e.lines = linesOf(d.lines);
        e.forDate = str(d.orderDate);
      } else if (r.action === "order.correct") {
        e.changes = [...diff(before, after, ["lines"]), ...lineDiff(before?.lines, after?.lines)];
      } else if (r.action === "order.cancel" && Array.isArray(d.lines)) {
        e.lines = (d.lines as LineD[]).filter((l) => qty(l.cancelled) !== "0").map((l) => {
          const li = lineItem.get(l.orderLineId ?? "");
          return itemText(li?.itemId, li?.unit, qty(l.cancelled));
        });
      }
    } else if (kind === "dispatch") {
      const dispatchId = r.entityType === "dispatch" ? r.entityId : (d.dispatchId as string);
      e.subject = partyName.get(dispatchParty.get(dispatchId) ?? (d.partyId as string)) ?? "—";
      e.href = dispatchId ? `/dispatches/${dispatchId}` : null;
      if (r.action === "dispatch.create") {
        e.lines = linesOf(d.lines);
        e.forDate = str(d.dispatchDate);
      } else if (r.action === "dispatch.correct") {
        e.changes = diff(before, after, ["lines", "channel", "inputMethod"]);
        e.lines = linesOf(after?.lines);
      } else if (r.action === "dispatch.link") {
        const l = dLine.get(d.dispatchLineId as string);
        e.lines = [itemText(l?.itemId, l?.unit, qty(d.quantity))];
      } else if (r.action.startsWith("dispatch.unmatched")) {
        const l = dLine.get(r.entityId);
        e.lines = d.quantity !== undefined ? [itemText(l?.itemId ?? d.itemId, l?.unit, qty(d.quantity))] : [];
      }
    } else if (kind === "stock") {
      e.href = "/stock";
      e.lines = linesOf(d.lines, (l) => l.change ?? l.quantity);
      e.forDate = str(d.date);
      if (Array.isArray(d.lines) && d.lines.length === 1) e.href = `/stock/item/${(d.lines as LineD[])[0].itemId}`;
    } else if (kind === "party") {
      e.subject = partyName.get(r.entityId) ?? str(d.name) ?? str(before?.name) ?? "—";
      e.href = partyName.has(r.entityId) ? `/manage/clients/${r.entityId}` : null;
      if (r.action === "party.update") e.changes = diff(before, after);
      if (r.action.startsWith("party.alias")) e.lines = [String(d.alias ?? "")];
      if (r.action === "party.create") e.lines = [str(d.phone)].filter((x): x is string => !!x);
    } else if (kind === "item" || kind === "product") {
      e.subject = item.get(r.entityId)?.name ?? str(d.name) ?? str(before?.name) ?? "—";
      e.href = item.has(r.entityId) ? `/manage/items/${r.entityId}` : null;
      if (r.action === "item.update") e.changes = diff(before, after);
      if (r.action.startsWith("item.alias")) e.lines = [String(d.alias ?? "")];
      if (r.action === "item.create") e.lines = [str(d.unit)].filter((x): x is string => !!x);
      if (r.action === "product.rename") e.changes = [{ field: "name", from: str(d.from), to: str(d.to) }];
    } else if (kind === "user") {
      e.subject = userName.get(r.entityId) ?? str(d.name) ?? "—";
      e.changes = r.action === "user.update" ? diff(before, after) : [];
      if (r.action === "user.add") e.lines = [str(d.role)].filter((x): x is string => !!x);
    } else if (kind === "company") {
      e.changes = diff(before, after);
    } else if (kind === "firm") {
      e.subject = str(d.name);
    } else if (kind === "import") {
      e.counts = { created: Number(d.created ?? 0), updated: Number(d.updated ?? 0) };
    }
    return e;
  });
  return { entries, more };
}

/** People who appear in the log (including ones since removed from the team), for the filter. */
export async function activityPeople(db: Db, ctx: Ctx) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can see the activity log");
  return db.select({ id: users.id, name: users.name, active: users.active }).from(users).where(eq(users.companyId, ctx.companyId)).orderBy(users.name);
}
