/**
 * Profiles: the company, its people (team) and the tax IDs of clients.
 * Owners only. Updated in place with before/after in the audit log; a full
 * Aadhaar number never goes into the log.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, companies, parties, pushSubscriptions, sessions, users } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { cleanAadhaar, cleanGstin, displayTaxId, isState, isValidAadhaar, isValidGstin, stateForGstin, type TaxIdType } from "@/lib/india";
import type { Ctx } from "@/ledger/service";

function requireOwner(ctx: Ctx) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can change this");
}

async function log(db: Db, ctx: Ctx, action: string, entityType: string, entityId: string, details: unknown) {
  await db.insert(auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action, entityType, entityId, details });
}

const isUnique = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

/** City: trimmed, or null. State: must be one from the list, or null. */
function place(input: { city?: string | null; state?: string | null }) {
  const out: { city?: string | null; state?: string | null } = {};
  if (input.city !== undefined) out.city = input.city?.trim() || null;
  if (input.state !== undefined) {
    const s = input.state?.trim() || null;
    if (s && !isState(s)) throw new LedgerError("INVALID_STATE", "Pick a state from the list");
    out.state = s;
  }
  return out;
}

// ---------------------------------------------------------------- company

export async function companyProfile(db: Db, ctx: Ctx) {
  const [c] = await db.select().from(companies).where(eq(companies.id, ctx.companyId));
  return { name: c.name, city: c.city, state: c.state };
}

export async function updateCompany(db: Db, ctx: Ctx, input: { name?: string; city?: string | null; state?: string | null }) {
  requireOwner(ctx);
  const name = input.name?.trim();
  if (name !== undefined && !name) throw new LedgerError("NAME_REQUIRED", "Name is required");
  const before = await companyProfile(db, ctx);
  const set = { ...(name ? { name } : {}), ...place(input) };
  await db.update(companies).set(set).where(eq(companies.id, ctx.companyId));
  await log(db, ctx, "company.update", "company", ctx.companyId, { before, after: set });
}

// ---------------------------------------------------------------- team

export type Role = "owner" | "staff" | "viewer";
const ROLES: Role[] = ["owner", "staff", "viewer"];

export async function teamList(db: Db, ctx: Ctx) {
  requireOwner(ctx);
  return db
    .select({ id: users.id, name: users.name, phone: users.phone, role: users.role, city: users.city, state: users.state, stockKeeper: users.stockKeeper, active: users.active })
    .from(users)
    .where(eq(users.companyId, ctx.companyId))
    .orderBy(asc(users.name));
}

export interface UserInput {
  name?: string;
  phone?: string;
  role?: Role;
  city?: string | null;
  state?: string | null;
  stockKeeper?: boolean;
  active?: boolean;
}

function checkUser(input: UserInput) {
  const out: Record<string, unknown> = { ...place(input) };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new LedgerError("NAME_REQUIRED", "Name is required");
    out.name = input.name.trim();
  }
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new LedgerError("INVALID_PHONE", "Enter a valid phone number");
    out.phone = phone;
  }
  if (input.role !== undefined) {
    if (!ROLES.includes(input.role)) throw new LedgerError("FORBIDDEN", "Unknown role");
    out.role = input.role;
  }
  if (input.stockKeeper !== undefined) out.stockKeeper = !!input.stockKeeper;
  if (input.active !== undefined) out.active = !!input.active;
  return out;
}

export async function addUser(db: Db, ctx: Ctx, input: UserInput & { name: string; phone: string; role: Role }) {
  requireOwner(ctx);
  const values = checkUser(input) as { name: string; phone: string; role: Role };
  try {
    const [u] = await db
      .insert(users)
      .values({ ...values, companyId: ctx.companyId })
      .returning({ id: users.id });
    await log(db, ctx, "user.add", "user", u.id, values);
    return u;
  } catch (e) {
    if (isUnique(e)) throw new LedgerError("DUPLICATE_PHONE", "This phone number is already in the team");
    throw e;
  }
}

export async function updateUser(db: Db, ctx: Ctx, userId: string, input: UserInput) {
  requireOwner(ctx);
  const set = checkUser(input);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId)));
    if (!before) throw new LedgerError("NOT_FOUND", "Not found");
    const losesOwner = before.role === "owner" && before.active && ((set.role && set.role !== "owner") || set.active === false);
    if (losesOwner) {
      if (userId === ctx.userId) throw new LedgerError("SELF_CHANGE", "Another owner has to change your own role or access");
      const others = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, "owner"), eq(users.active, true), ne(users.id, userId)));
      if (!others.length) throw new LedgerError("LAST_OWNER", "The company needs at least one owner");
    }
    try {
      await tx.update(users).set(set).where(eq(users.id, userId));
    } catch (e) {
      if (isUnique(e)) throw new LedgerError("DUPLICATE_PHONE", "This phone number is already in the team");
      throw e;
    }
    // Removed or new phone number: log out everywhere and stop reminders to old phones.
    if (set.active === false || (set.phone && set.phone !== before.phone)) {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId)));
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    }
    const pick = (u: Record<string, unknown>) => Object.fromEntries(Object.keys(set).map((k) => [k, u[k]]));
    await log(tx, ctx, "user.update", "user", userId, { before: pick(before), after: set });
  });
}

// ---------------------------------------------------------------- client profile

export interface PartyProfileInput {
  city?: string | null;
  state?: string | null;
  /** null clears the tax ID; undefined leaves it as is. */
  taxIdType?: TaxIdType | null;
  taxId?: string | null;
}

/** Validates and cleans a client's place and tax ID. A GSTIN fills in the state when none is given. */
export function partyProfileSet(input: PartyProfileInput, currentState: string | null) {
  const out: Record<string, string | null> = { ...place(input) };
  if (input.taxIdType === undefined) return out;
  if (input.taxIdType === null) return { ...out, taxIdType: null, taxId: null };
  const raw = input.taxId ?? "";
  if (input.taxIdType === "gstin") {
    if (!isValidGstin(raw)) throw new LedgerError("INVALID_GSTIN", "That GSTIN isn't valid");
    const g = cleanGstin(raw);
    const fromGst = stateForGstin(g);
    const state = out.state !== undefined ? out.state : currentState;
    if (fromGst && !state) out.state = fromGst;
    return { ...out, taxIdType: "gstin", taxId: g };
  }
  if (input.taxIdType === "aadhaar") {
    if (!isValidAadhaar(raw)) throw new LedgerError("INVALID_AADHAAR", "That Aadhaar number isn't valid");
    return { ...out, taxIdType: "aadhaar", taxId: cleanAadhaar(raw) };
  }
  throw new LedgerError("INVALID_GSTIN", "Unknown tax ID type");
}

/** For logs: never the full Aadhaar. */
export const safeTaxId = (type: string | null | undefined, id: string | null | undefined) => (type && id ? displayTaxId(type, id) : null);

/** Full Aadhaar for an owner who asked to see it; the look is logged. */
export async function revealTaxId(db: Db, ctx: Ctx, partyId: string) {
  requireOwner(ctx);
  const [p] = await db.select({ type: parties.taxIdType, id: parties.taxId }).from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, ctx.companyId)));
  if (!p) throw new LedgerError("NOT_FOUND", "Client not found");
  if (p.type === "aadhaar") await log(db, ctx, "party.taxid.reveal", "party", partyId, {});
  return p.id;
}
