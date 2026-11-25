/**
 * Bills: one per dispatch, GST or kacha. Owners and supervisors make and
 * change them; owners, supervisors and viewers can see them.
 *
 * Like orders, a bill is a header plus append-only revisions. The seller's
 * and party's details are copied into each revision, so a bill already
 * given doesn't change when a profile does. Numbers come from a counter per
 * firm, kind and financial year and are never reused: a cancelled bill keeps
 * its number, and switching GST ↔ kacha takes the next number of the other
 * series.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { billCounters, billLines, billRevisions, bills, companies, dispatchRevisions, dispatches, items, parties, users } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { assertEntryDate, todayIST } from "@/lib/dates";
import { maskAadhaar } from "@/lib/india";
import { centiToDecimal, toCenti, toPositiveCenti } from "@/lib/qty";
import { audit, lockCompany, stockOf, type Ctx } from "@/ledger/service";
import { dispatchDetail } from "@/ledger/queries";
import { billNumber, computeBill, defaultPrefix, financialYear, type BillKind, type BillTotals } from "./compute";

export const canMakeBills = (ctx: Pick<Ctx, "role" | "supervisor">) => ctx.role === "owner" || (ctx.role === "staff" && !!ctx.supervisor);
export const canSeeBills = (ctx: Pick<Ctx, "role" | "supervisor">) => canMakeBills(ctx) || ctx.role === "viewer";

function requireMaker(ctx: Ctx) {
  if (!canMakeBills(ctx)) throw new LedgerError("FORBIDDEN", "Only owners and supervisors can make bills");
}
function requireViewer(ctx: Ctx) {
  if (!canSeeBills(ctx)) throw new LedgerError("FORBIDDEN", "Not allowed to see bills");
}

export interface PartyOnBill {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  phone: string | null;
  /** Masked (XXXX XXXX 1234), for parties without a GSTIN. Older bills don't have it. */
  aadhaar?: string | null;
}
export interface SellerOnBill extends PartyOnBill {
  email?: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  upiId: string | null;
}

export interface BillLineIn {
  itemId?: string | null;
  name: string;
  hsn?: string | null;
  quantity: string | number;
  unit: string;
  /** Rupees, e.g. "450.50". */
  rate: string | number;
  discountPct?: string | number;
  gstRate?: string | number;
}

/** The invoice header: how and where the goods went. */
export interface BillShipping {
  transport: string | null;
  destination: string | null;
  docket: string | null;
  paymentTerms: string | null;
  shipTo: { name: string; address: string | null } | null;
}

export interface BillInput extends Partial<BillShipping> {
  kind: BillKind;
  billDate: string;
  lines: BillLineIn[];
  /** Freight/packing, rupees. */
  charges?: string | number;
  notes?: string | null;
}

const SHORT = 120;
const LONG = 400;

function shortText(v: unknown, max = SHORT): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new LedgerError("INVALID_INPUT", "Expected text");
  const t = v.trim().replace(/[ \t]+/g, " ");
  if (t.length > max) throw new LedgerError("TEXT_TOO_LONG", "Too long", { max });
  return t || null;
}

/** The shipping fields of a request body, untouched (cleanShipping checks them). */
export const shippingIn = (b: Partial<BillShipping>): Partial<BillShipping> => ({ transport: b.transport, destination: b.destination, docket: b.docket, paymentTerms: b.paymentTerms, shipTo: b.shipTo });

function cleanShipping(input: Partial<BillShipping>): BillShipping {
  const raw = input.shipTo;
  let shipTo: BillShipping["shipTo"] = null;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "object") throw new LedgerError("INVALID_INPUT", "Ship to must be a name and address");
    const name = shortText(raw.name);
    const address = shortText(raw.address, LONG);
    if (!name && address) throw new LedgerError("SHIP_TO_NAME", "Who are the goods going to?");
    shipTo = name ? { name, address } : null;
  }
  return {
    transport: shortText(input.transport),
    destination: shortText(input.destination),
    docket: shortText(input.docket),
    paymentTerms: shortText(input.paymentTerms),
    shipTo,
  };
}

/** Percent with up to 2 decimals as hundredths: "5" → 500. */
function pct(v: string | number | undefined, code: "INVALID_DISCOUNT" | "INVALID_GST_RATE"): number {
  if (v === undefined || v === "") return 0;
  let c: number;
  try {
    c = toCenti(v);
  } catch {
    throw new LedgerError(code, `Not a percent: ${v}`);
  }
  if (c > 10_000) throw new LedgerError(code, `More than 100%: ${v}`);
  return c;
}

function rupees(v: string | number | undefined): number {
  if (v === undefined || v === "") return 0;
  try {
    return toCenti(v);
  } catch {
    throw new LedgerError("INVALID_RATE", `Not an amount: ${v}`);
  }
}

interface CleanLine {
  itemId: string | null;
  name: string;
  hsn: string | null;
  quantity: number;
  unit: string;
  rate: number;
  discountPct: number;
  gstRate: number;
}

function cleanLines(lines: BillLineIn[]): CleanLine[] {
  if (!Array.isArray(lines) || !lines.length) throw new LedgerError("NO_LINES", "A bill needs at least one line");
  return lines.map((l) => {
    const name = String(l.name ?? "").trim();
    if (!name) throw new LedgerError("NAME_REQUIRED", "Every line needs a name");
    return {
      itemId: l.itemId || null,
      name,
      hsn: l.hsn ? String(l.hsn).replace(/\s+/g, "") || null : null,
      quantity: toPositiveCenti(l.quantity),
      unit: String(l.unit ?? "").trim() || "pcs",
      rate: rupees(l.rate),
      discountPct: pct(l.discountPct, "INVALID_DISCOUNT"),
      gstRate: pct(l.gstRate, "INVALID_GST_RATE"),
    };
  });
}

const totalsOf = (kind: BillKind, lines: CleanLine[], interstate: boolean, charges: number) => computeBill(kind, lines, { interstate, charges });

/** Different states → IGST. Unknown state on either side: treated as the same state. */
const isInterstate = (seller: string | null, buyer: string | null) => !!seller && !!buyer && seller !== buyer;

async function sellerNow(db: Db, companyId: string): Promise<SellerOnBill & { prefix: string }> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId));
  return {
    name: c.name,
    address: c.address,
    city: c.city,
    state: c.state,
    gstin: c.gstin,
    phone: c.phone,
    email: c.email,
    bankName: c.bankName,
    bankAccount: c.bankAccount,
    bankIfsc: c.bankIfsc,
    upiId: c.upiId,
    prefix: c.billPrefix || defaultPrefix(c.name),
  };
}

async function partyNow(db: Db, companyId: string, partyId: string): Promise<PartyOnBill> {
  const [p] = await db.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, companyId)));
  if (!p) throw new LedgerError("UNKNOWN_PARTY", "Party not found");
  return {
    name: p.name,
    address: p.address,
    city: p.city,
    state: p.state,
    gstin: p.taxIdType === "gstin" ? p.taxId : null,
    phone: p.phone,
    aadhaar: p.taxIdType === "aadhaar" && p.taxId ? maskAadhaar(p.taxId) : null,
  };
}

async function nextNumber(tx: Db, companyId: string, prefix: string, kind: BillKind, billDate: string) {
  const fy = financialYear(billDate);
  const [row] = await tx
    .insert(billCounters)
    .values({ companyId, kind, fy, last: 1 })
    .onConflictDoUpdate({ target: [billCounters.companyId, billCounters.kind, billCounters.fy], set: { last: sql`${billCounters.last} + 1` } })
    .returning({ last: billCounters.last });
  return billNumber(prefix, kind, fy, row.last);
}

const newToken = () => randomBytes(18).toString("base64url");

async function currentDispatchRev(db: Db, dispatchId: string) {
  const [r] = await db.select().from(dispatchRevisions).where(eq(dispatchRevisions.dispatchId, dispatchId)).orderBy(desc(dispatchRevisions.rev)).limit(1);
  return r;
}

async function writeRevision(
  tx: Db,
  ctx: Ctx,
  billId: string,
  rev: number,
  values: { kind: BillKind; number: string; billDate: string; partyId: string; party: PartyOnBill; seller: SellerOnBill; interstate: boolean; charges: number; dispatchRev: number; notes: string | null; status: "active" | "cancelled"; reason: string | null } & BillShipping,
  lines: CleanLine[],
) {
  const totals = totalsOf(values.kind, lines, values.interstate, values.charges);
  const [r] = await tx
    .insert(billRevisions)
    .values({
      companyId: ctx.companyId,
      billId,
      rev,
      ...values,
      charges: centiToDecimal(values.charges),
      total: centiToDecimal(totals.total),
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })
    .returning({ id: billRevisions.id });
  await tx.insert(billLines).values(
    lines.map((l, i) => ({
      companyId: ctx.companyId,
      billRevisionId: r.id,
      lineNo: i + 1,
      itemId: l.itemId,
      name: l.name,
      hsn: l.hsn,
      quantity: centiToDecimal(l.quantity),
      unit: l.unit,
      rate: centiToDecimal(l.rate),
      discountPct: centiToDecimal(l.discountPct),
      gstRate: centiToDecimal(l.gstRate),
    })),
  );
  return totals;
}

/** Items of the dispatch must belong to this firm's godown; free-text lines (no item) are fine. */
async function assertBillItems(tx: Db, ctx: Ctx, lines: CleanLine[]) {
  const ids = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const found = await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, ids), eq(items.companyId, stockOf(ctx))));
  if (found.length !== ids.length) throw new LedgerError("UNKNOWN_ITEM", "Item not found");
}

export async function createBill(db: Db, ctx: Ctx, dispatchId: string, input: BillInput) {
  requireMaker(ctx);
  if (input.kind !== "gst" && input.kind !== "kacha") throw new LedgerError("INVALID_INPUT", "Unknown bill kind");
  assertEntryDate(input.billDate, ctx.now);
  const lines = cleanLines(input.lines);
  const charges = rupees(input.charges);
  const shipping = cleanShipping(input);
  return db.transaction(async (tx) => {
    await lockCompany(tx, ctx.companyId);
    const [d] = await tx.select({ id: dispatches.id }).from(dispatches).where(and(eq(dispatches.id, dispatchId), eq(dispatches.companyId, ctx.companyId)));
    if (!d) throw new LedgerError("NOT_FOUND", "Dispatch not found");
    const [existing] = await tx.select({ id: bills.id }).from(bills).where(and(eq(bills.companyId, ctx.companyId), eq(bills.dispatchId, dispatchId)));
    if (existing) throw new LedgerError("BILL_EXISTS", "This dispatch already has a bill", { billId: existing.id });
    const drev = await currentDispatchRev(tx, dispatchId);
    if (drev.status === "cancelled") throw new LedgerError("DISPATCH_CANCELLED", "This dispatch was cancelled");
    await assertBillItems(tx, ctx, lines);
    const { prefix, ...seller } = await sellerNow(tx, ctx.companyId);
    const party = await partyNow(tx, ctx.companyId, drev.partyId);
    const interstate = isInterstate(seller.state, party.state);
    const number = await nextNumber(tx, ctx.companyId, prefix, input.kind, input.billDate);
    const [b] = await tx.insert(bills).values({ companyId: ctx.companyId, dispatchId, shareToken: newToken(), createdBy: ctx.userId, createdAt: ctx.now }).returning({ id: bills.id });
    const totals = await writeRevision(
      tx,
      ctx,
      b.id,
      1,
      { kind: input.kind, number, billDate: input.billDate, partyId: drev.partyId, party, seller, interstate, charges, dispatchRev: drev.rev, notes: input.notes?.trim() || null, status: "active", reason: null, ...shipping },
      lines,
    );
    await audit(tx, ctx, "bill.create", "bill", b.id, { dispatchId, number, kind: input.kind, total: totals.total });
    return { billId: b.id, number };
  });
}

async function currentRevision(db: Db, ctx: Ctx, billId: string) {
  const [b] = await db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.companyId, ctx.companyId)));
  if (!b) throw new LedgerError("NOT_FOUND", "Bill not found");
  const [cur] = await db.select().from(billRevisions).where(eq(billRevisions.billId, billId)).orderBy(desc(billRevisions.rev)).limit(1);
  return { bill: b, cur };
}

/** Change a bill: a new revision. Same kind keeps the number; GST ↔ kacha takes the next number of the other series. */
export async function reviseBill(db: Db, ctx: Ctx, billId: string, input: BillInput & { baseRev: number; reason?: string | null }) {
  requireMaker(ctx);
  if (input.kind !== "gst" && input.kind !== "kacha") throw new LedgerError("INVALID_INPUT", "Unknown bill kind");
  assertEntryDate(input.billDate, ctx.now);
  const lines = cleanLines(input.lines);
  const charges = rupees(input.charges);
  const shipping = cleanShipping(input);
  return db.transaction(async (tx) => {
    await lockCompany(tx, ctx.companyId);
    const { bill, cur } = await currentRevision(tx, ctx, billId);
    if (cur.rev !== input.baseRev) throw new LedgerError("STALE_REVISION", "Bill was changed by someone else", { currentRev: cur.rev });
    if (cur.status === "cancelled") throw new LedgerError("ALREADY_CANCELLED", "This bill was cancelled");
    await assertBillItems(tx, ctx, lines);
    const drev = await currentDispatchRev(tx, bill.dispatchId);
    const { prefix, ...seller } = await sellerNow(tx, ctx.companyId);
    const party = await partyNow(tx, ctx.companyId, cur.partyId);
    const interstate = isInterstate(seller.state, party.state);
    // A new number when the kind changes, or the date moves into another financial year.
    const sameSeries = input.kind === cur.kind && financialYear(input.billDate) === financialYear(cur.billDate);
    const number = sameSeries ? cur.number : await nextNumber(tx, ctx.companyId, prefix, input.kind, input.billDate);
    const totals = await writeRevision(
      tx,
      ctx,
      billId,
      cur.rev + 1,
      { kind: input.kind, number, billDate: input.billDate, partyId: cur.partyId, party, seller, interstate, charges, dispatchRev: drev.rev, notes: input.notes?.trim() || null, status: "active", reason: input.reason?.trim() || null, ...shipping },
      lines,
    );
    await audit(tx, ctx, "bill.revise", "bill", billId, { rev: cur.rev + 1, number, previousNumber: number === cur.number ? undefined : cur.number, kind: input.kind, total: totals.total });
    return { rev: cur.rev + 1, number };
  });
}

/** Cancel: a final revision with the same lines; the number stays used. */
export async function cancelBill(db: Db, ctx: Ctx, billId: string, input: { baseRev: number; reason?: string | null }) {
  requireMaker(ctx);
  return db.transaction(async (tx) => {
    await lockCompany(tx, ctx.companyId);
    const { cur } = await currentRevision(tx, ctx, billId);
    if (cur.rev !== input.baseRev) throw new LedgerError("STALE_REVISION", "Bill was changed by someone else", { currentRev: cur.rev });
    if (cur.status === "cancelled") throw new LedgerError("ALREADY_CANCELLED", "Already cancelled");
    const lines = await linesOf(tx, cur.id);
    await writeRevision(
      tx,
      ctx,
      billId,
      cur.rev + 1,
      {
        kind: cur.kind,
        number: cur.number,
        billDate: cur.billDate,
        partyId: cur.partyId,
        party: cur.party as PartyOnBill,
        seller: cur.seller as SellerOnBill,
        interstate: cur.interstate,
        charges: toCenti(cur.charges),
        dispatchRev: cur.dispatchRev,
        notes: cur.notes,
        ...shippingOf(cur),
        status: "cancelled",
        reason: input.reason?.trim() || null,
      },
      lines,
    );
    await audit(tx, ctx, "bill.cancel", "bill", billId, { number: cur.number, reason: input.reason ?? null });
  });
}

const shippingOf = (r: typeof billRevisions.$inferSelect): BillShipping => ({
  transport: r.transport,
  destination: r.destination,
  docket: r.docket,
  paymentTerms: r.paymentTerms,
  shipTo: (r.shipTo as BillShipping["shipTo"]) ?? null,
});

async function linesOf(db: Db, revisionId: string): Promise<CleanLine[]> {
  const rows = await db.select().from(billLines).where(eq(billLines.billRevisionId, revisionId)).orderBy(asc(billLines.lineNo));
  return rows.map((l) => ({
    itemId: l.itemId,
    name: l.name,
    hsn: l.hsn,
    quantity: toCenti(l.quantity),
    unit: l.unit,
    rate: toCenti(l.rate),
    discountPct: toCenti(l.discountPct),
    gstRate: toCenti(l.gstRate),
  }));
}

export interface BillView extends BillShipping {
  id: string;
  dispatchId: string;
  shareToken: string;
  rev: number;
  kind: BillKind;
  number: string;
  billDate: string;
  partyId: string;
  party: PartyOnBill;
  seller: SellerOnBill;
  interstate: boolean;
  charges: number;
  notes: string | null;
  status: "active" | "cancelled";
  reason: string | null;
  lines: CleanLine[];
  totals: BillTotals;
  /** The dispatch was changed (or cancelled) after this bill was made. */
  dispatchChanged: boolean;
  dispatchCancelled: boolean;
  history: { rev: number; number: string; kind: BillKind; status: string; by: string; at: Date; reason: string | null }[];
}

async function viewOf(db: Db, bill: typeof bills.$inferSelect): Promise<BillView> {
  const revs = await db.select().from(billRevisions).where(eq(billRevisions.billId, bill.id)).orderBy(asc(billRevisions.rev));
  const cur = revs[revs.length - 1];
  const lines = await linesOf(db, cur.id);
  const drev = await currentDispatchRev(db, bill.dispatchId);
  const us = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, bill.companyId));
  const who = new Map(us.map((u) => [u.id, u.name]));
  const charges = toCenti(cur.charges);
  return {
    id: bill.id,
    dispatchId: bill.dispatchId,
    shareToken: bill.shareToken,
    rev: cur.rev,
    kind: cur.kind,
    number: cur.number,
    billDate: cur.billDate,
    partyId: cur.partyId,
    party: cur.party as PartyOnBill,
    seller: cur.seller as SellerOnBill,
    interstate: cur.interstate,
    charges,
    notes: cur.notes,
    ...shippingOf(cur),
    status: cur.status,
    reason: cur.reason,
    lines,
    totals: totalsOf(cur.kind, lines, cur.interstate, charges),
    dispatchChanged: drev.rev !== cur.dispatchRev,
    dispatchCancelled: drev.status === "cancelled",
    history: revs.map((r) => ({ rev: r.rev, number: r.number, kind: r.kind, status: r.status, by: who.get(r.createdBy) ?? "?", at: r.createdAt, reason: r.reason })),
  };
}

export async function billDetail(db: Db, ctx: Ctx, billId: string): Promise<BillView> {
  requireViewer(ctx);
  const [b] = await db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.companyId, ctx.companyId)));
  if (!b) throw new LedgerError("NOT_FOUND", "Bill not found");
  return viewOf(db, b);
}

/** For the link sent to the party: no login, the token is the key. */
export async function billByToken(db: Db, token: string): Promise<BillView | null> {
  if (!/^[\w-]{20,40}$/.test(token)) return null;
  const [b] = await db.select().from(bills).where(eq(bills.shareToken, token));
  return b ? viewOf(db, b) : null;
}

/** The bill of a dispatch, for its screen. */
export async function billForDispatch(db: Db, ctx: Ctx, dispatchId: string) {
  if (!canSeeBills(ctx)) return null;
  const [b] = await db.select({ id: bills.id }).from(bills).where(and(eq(bills.companyId, ctx.companyId), eq(bills.dispatchId, dispatchId)));
  if (!b) return null;
  const [cur] = await db.select({ number: billRevisions.number, status: billRevisions.status, total: billRevisions.total }).from(billRevisions).where(eq(billRevisions.billId, b.id)).orderBy(desc(billRevisions.rev)).limit(1);
  return { id: b.id, number: cur.number, status: cur.status, total: toCenti(cur.total) };
}

/** Bills, newest first (current revision of each). */
export async function billList(db: Db, ctx: Ctx, filter: { partyId?: string; limit?: number } = {}) {
  requireViewer(ctx);
  const latest = db
    .select({ billId: billRevisions.billId, maxRev: sql<number>`max(${billRevisions.rev})`.as("max_rev") })
    .from(billRevisions)
    .where(eq(billRevisions.companyId, ctx.companyId))
    .groupBy(billRevisions.billId)
    .as("latest");
  const rows = await db
    .select({ id: billRevisions.billId, number: billRevisions.number, kind: billRevisions.kind, billDate: billRevisions.billDate, partyId: billRevisions.partyId, party: billRevisions.party, total: billRevisions.total, status: billRevisions.status, createdAt: billRevisions.createdAt })
    .from(billRevisions)
    .innerJoin(latest, and(eq(latest.billId, billRevisions.billId), eq(latest.maxRev, billRevisions.rev)))
    .where(filter.partyId ? eq(billRevisions.partyId, filter.partyId) : undefined)
    .orderBy(desc(billRevisions.billDate), desc(billRevisions.createdAt))
    .limit(filter.limit ?? 200);
  return rows.map((r) => ({ ...r, partyName: (r.party as PartyOnBill).name, total: toCenti(r.total) }));
}

/**
 * Last rate per item for this party (paise), else the last rate any party
 * paid for it; from active bills of this firm. Used to fill in a new bill.
 */
export async function lastRates(db: Db, ctx: Ctx, partyId: string, itemIds: string[]): Promise<Map<string, { rate: number; forParty: boolean }>> {
  const out = new Map<string, { rate: number; forParty: boolean }>();
  if (!itemIds.length) return out;
  const rows = await db
    .select({ itemId: billLines.itemId, rate: billLines.rate, partyId: billRevisions.partyId, at: billRevisions.createdAt, status: billRevisions.status, billId: billRevisions.billId, rev: billRevisions.rev })
    .from(billLines)
    .innerJoin(billRevisions, eq(billRevisions.id, billLines.billRevisionId))
    .where(and(eq(billLines.companyId, ctx.companyId), inArray(billLines.itemId, itemIds)))
    .orderBy(desc(billRevisions.createdAt));
  // Only each bill's current revision, and only if it isn't cancelled.
  const latestRev = new Map<string, number>();
  for (const r of rows) latestRev.set(r.billId, Math.max(latestRev.get(r.billId) ?? 0, r.rev));
  for (const r of rows) {
    if (!r.itemId || r.rev !== latestRev.get(r.billId) || r.status !== "active") continue;
    const prev = out.get(r.itemId);
    const forParty = r.partyId === partyId;
    if (!prev || (forParty && !prev.forParty)) out.set(r.itemId, { rate: toCenti(r.rate), forParty });
  }
  return out;
}

/** Everything the new-bill form starts with: the dispatch's lines with HSN, GST rate and last rates. */
export async function billDraft(db: Db, ctx: Ctx, dispatchId: string) {
  requireMaker(ctx);
  const existing = await billForDispatch(db, ctx, dispatchId);
  if (existing) throw new LedgerError("BILL_EXISTS", "This dispatch already has a bill", { billId: existing.id });
  const d = await dispatchDetail(db, ctx, dispatchId);
  if (d.status === "cancelled") throw new LedgerError("DISPATCH_CANCELLED", "This dispatch was cancelled");
  const itemIds = [...new Set(d.lines.map((l) => l.itemId))];
  const its = itemIds.length ? await db.select({ id: items.id, hsn: items.hsn, gstRate: items.gstRate }).from(items).where(inArray(items.id, itemIds)) : [];
  const tax = new Map(its.map((i) => [i.id, i]));
  const rates = await lastRates(db, ctx, d.partyId, itemIds);
  const { prefix, ...seller } = await sellerNow(db, ctx.companyId);
  const party = await partyNow(db, ctx.companyId, d.partyId);
  // The dispatch says which transporter took it; else the transporter and terms usually stay the same for a party.
  const [last] = await db
    .select({ transport: billRevisions.transport, paymentTerms: billRevisions.paymentTerms, destination: billRevisions.destination })
    .from(billRevisions)
    .where(and(eq(billRevisions.companyId, ctx.companyId), eq(billRevisions.partyId, d.partyId), eq(billRevisions.status, "active")))
    .orderBy(desc(billRevisions.createdAt))
    .limit(1);
  return {
    shipping: { transport: d.transport ?? last?.transport ?? null, destination: last?.destination ?? party.city, docket: null, paymentTerms: last?.paymentTerms ?? null, shipTo: null } satisfies BillShipping,
    dispatchId,
    dispatchDate: d.dispatchDate,
    billDate: todayIST(ctx.now) < d.dispatchDate ? todayIST(ctx.now) : d.dispatchDate,
    partyId: d.partyId,
    party,
    seller,
    prefix,
    interstate: isInterstate(seller.state, party.state),
    lines: d.lines.map((l) => ({
      itemId: l.itemId,
      name: l.itemName,
      hsn: tax.get(l.itemId)?.hsn ?? null,
      quantity: l.quantity,
      unit: l.unit,
      gstRate: tax.get(l.itemId)?.gstRate === null || tax.get(l.itemId)?.gstRate === undefined ? null : toCenti(tax.get(l.itemId)!.gstRate!),
      rate: rates.get(l.itemId)?.rate ?? null,
      rateFrom: rates.get(l.itemId) ? (rates.get(l.itemId)!.forParty ? ("party" as const) : ("item" as const)) : null,
    })),
  };
}
