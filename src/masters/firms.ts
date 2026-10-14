/**
 * One person, several firms (factories, shops). Each firm is its own company:
 * own clients, orders, dispatches and team. A person belongs to a firm through
 * a user row with their phone, so the same phone can be owner in firm A and
 * staff in firm B. Switching firm moves the logged-in session to the user row
 * of that firm.
 *
 * Stock: a firm keeps its own items and stock, or shares the godown of
 * another firm (same items, one stock; orders and dispatches of every sharing
 * firm count against it). Sharing points at a firm with its own stock, never
 * at one that shares itself, and can only be set or changed while the firm
 * has no items, orders or dispatches of its own, because those would belong to
 * the wrong stock afterwards.
 */
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, companies, dispatchRevisions, items, orderRevisions, sessions, users } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { normalizeName } from "@/lib/normalize";
import { isState } from "@/lib/india";
import { lockCompany } from "@/ledger/service";
import type { SessionUser } from "@/auth/login";

export const MAX_FIRMS = 20;
const MAX_NAME = 80;

export interface Firm {
  companyId: string;
  name: string;
  city: string | null;
  state: string | null;
  role: "owner" | "staff" | "viewer";
  current: boolean;
  /** The firm whose godown this one uses, or null for its own stock. */
  stockCompanyId: string | null;
  stockName: string | null;
  /** Other firms that use this firm's stock. */
  sharedBy: string[];
}

/** Every firm this person (phone) is active in, current one first, then by name. */
export async function myFirms(db: Db, me: Pick<SessionUser, "phone" | "companyId">): Promise<Firm[]> {
  const rows = await db
    .select({ companyId: companies.id, name: companies.name, city: companies.city, state: companies.state, role: users.role, stockCompanyId: companies.stockCompanyId })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(and(eq(users.phone, me.phone), eq(users.active, true)))
    .orderBy(asc(companies.name));
  const ids = [...rows.map((r) => r.companyId), ...rows.flatMap((r) => (r.stockCompanyId ? [r.stockCompanyId] : []))];
  const related = ids.length
    ? await db
        .select({ id: companies.id, name: companies.name, stockCompanyId: companies.stockCompanyId })
        .from(companies)
        .where(or(inArray(companies.id, ids), inArray(companies.stockCompanyId, ids)))
    : [];
  const nameOf = new Map(related.map((c) => [c.id, c.name]));
  return rows
    .map((r) => ({
      ...r,
      current: r.companyId === me.companyId,
      stockName: r.stockCompanyId ? (nameOf.get(r.stockCompanyId) ?? null) : null,
      sharedBy: related.filter((c) => c.stockCompanyId === r.companyId).map((c) => c.name),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
}

/** This person's user row in a firm (active only). */
async function membership(db: Db, phone: string, companyId: string) {
  const [m] = await db
    .select({ userId: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.phone, phone), eq(users.companyId, companyId), eq(users.active, true)));
  return m;
}

/** Move this login to another firm the same person belongs to. */
export async function switchFirm(db: Db, me: SessionUser, companyId: string) {
  if (companyId === me.companyId) return { companyId };
  const m = await membership(db, me.phone, companyId);
  if (!m) throw new LedgerError("NOT_FOUND", "You are not in that firm");
  await db.update(sessions).set({ userId: m.userId, companyId }).where(eq(sessions.id, me.sessionId));
  return { companyId };
}

export interface NewFirmInput {
  name: string;
  city?: string | null;
  state?: string | null;
  /** Use this firm's godown (items and stock). Null/omitted = its own. */
  stockCompanyId?: string | null;
  /** Add the current firm's other people to the new firm, with the same roles. */
  copyTeam?: boolean;
}

function cleanName(name: string | undefined) {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (!n) throw new LedgerError("NAME_REQUIRED", "Name is required");
  if (n.length > MAX_NAME) throw new LedgerError("NAME_TOO_LONG", "Name is too long");
  return n;
}

/** The firm that actually holds the stock (follows one share), with checks that this person may use it. */
async function resolveStockFirm(db: Db, me: SessionUser, stockCompanyId: string) {
  const [target] = await db.select({ id: companies.id, stockCompanyId: companies.stockCompanyId }).from(companies).where(eq(companies.id, stockCompanyId));
  if (!target) throw new LedgerError("NOT_FOUND", "Firm not found");
  const root = target.stockCompanyId ?? target.id;
  // Sharing shows that firm's items and stock to this firm's people: only its owner may allow it.
  for (const id of new Set([target.id, root])) {
    const m = await membership(db, me.phone, id);
    if (!m || m.role !== "owner") throw new LedgerError("FORBIDDEN", "You must be an owner of the firm whose stock is shared");
  }
  return root;
}

/** A new firm with this person as owner. Only owners can add firms. */
export async function createFirm(db: Db, me: SessionUser, input: NewFirmInput) {
  if (me.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can add a firm");
  const name = cleanName(input.name);
  const state = input.state?.trim() || null;
  if (state && !isState(state)) throw new LedgerError("INVALID_STATE", "Pick a state from the list");
  const mine = await myFirms(db, me);
  if (mine.length >= MAX_FIRMS) throw new LedgerError("TOO_MANY_FIRMS", "Too many firms", { max: MAX_FIRMS });
  if (mine.some((f) => normalizeName(f.name) === normalizeName(name))) throw new LedgerError("FIRM_NAME_TAKEN", "You already have a firm with this name");
  const stockId = input.stockCompanyId ? await resolveStockFirm(db, me, input.stockCompanyId) : null;

  return db.transaction(async (tx) => {
    const [me2] = await tx.select().from(users).where(eq(users.id, me.userId));
    const [firm] = await tx.insert(companies).values({ name, city: input.city?.trim() || null, state, stockCompanyId: stockId }).returning();
    const [owner] = await tx
      .insert(users)
      .values({ companyId: firm.id, phone: me.phone, name: me.name, role: "owner", language: me.language, city: me2?.city ?? null, state: me2?.state ?? null })
      .returning();
    let copied = 0;
    if (input.copyTeam) {
      const team = await tx.select().from(users).where(and(eq(users.companyId, me.companyId), eq(users.active, true), ne(users.phone, me.phone)));
      for (const u of team) {
        await tx.insert(users).values({ companyId: firm.id, phone: u.phone, name: u.name, role: u.role, language: u.language, city: u.city, state: u.state, stockKeeper: u.stockKeeper });
        copied++;
      }
    }
    const details = { name, city: firm.city, state, stockCompanyId: stockId, copiedTeam: copied, from: me.companyId };
    await tx.insert(auditLog).values({ companyId: firm.id, userId: owner.id, action: "firm.create", entityType: "company", entityId: firm.id, details });
    await tx.insert(auditLog).values({ companyId: me.companyId, userId: me.userId, action: "firm.create", entityType: "company", entityId: firm.id, details });
    return { companyId: firm.id, copied };
  });
}

/**
 * Switch a firm between its own stock and another firm's godown. Allowed only
 * while the firm has no items, orders or dispatches of its own.
 */
export async function setFirmStock(db: Db, me: SessionUser, companyId: string, stockCompanyId: string | null) {
  const m = await membership(db, me.phone, companyId);
  if (!m || m.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can change this");
  if (stockCompanyId === companyId) stockCompanyId = null;
  const root = stockCompanyId ? await resolveStockFirm(db, me, stockCompanyId) : null;
  if (root === companyId) throw new LedgerError("STOCK_LOOP", "A firm can't share its own stock with itself");

  return db.transaction(async (tx) => {
    await lockCompany(tx, companyId);
    if (root) await lockCompany(tx, root);
    const [firm] = await tx.select().from(companies).where(eq(companies.id, companyId));
    if (!firm) throw new LedgerError("NOT_FOUND", "Firm not found");
    if ((firm.stockCompanyId ?? null) === root) return { changed: false };
    const [{ n: sharers }] = await tx.select({ n: sql<number>`count(*)::int` }).from(companies).where(eq(companies.stockCompanyId, companyId));
    if (root && sharers > 0) throw new LedgerError("STOCK_SHARED_BY_OTHERS", "Other firms use this firm's stock", { firms: sharers });
    const [[i], [o], [d]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.companyId, companyId)),
      tx.select({ n: sql<number>`count(*)::int` }).from(orderRevisions).where(eq(orderRevisions.companyId, companyId)),
      tx.select({ n: sql<number>`count(*)::int` }).from(dispatchRevisions).where(eq(dispatchRevisions.companyId, companyId)),
    ]);
    if (i.n > 0) throw new LedgerError("FIRM_HAS_ITEMS", "This firm already has its own items", { items: i.n });
    if (o.n + d.n > 0) throw new LedgerError("FIRM_HAS_ENTRIES", "This firm already has orders or dispatches", { entries: o.n + d.n });
    await tx.update(companies).set({ stockCompanyId: root }).where(eq(companies.id, companyId));
    await tx.insert(auditLog).values({
      companyId,
      userId: m.userId,
      action: "firm.stock",
      entityType: "company",
      entityId: companyId,
      details: { before: firm.stockCompanyId, after: root },
    });
    return { changed: true };
  });
}
