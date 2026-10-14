/**
 * Importing a spreadsheet of clients or items (with stock).
 *
 * Two steps, both on the server: `plan*` says, row by row, what would happen
 * (new, update, already the same, needs a choice, skipped, can't import) and
 * changes nothing; `apply*` plans again inside one transaction with the
 * person's choices and then writes. Planning again means the preview can never
 * be applied stale: whatever changed in between is taken into account.
 *
 * Matching an existing client: same GSTIN first, then the exact name or an
 * extra name. A close spelling is only ever a suggestion the person confirms.
 * Existing details are filled in where empty and kept where they differ,
 * unless the person chose "replace existing details".
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, itemAliases, items, parties, partyAliases } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { normalizeName } from "@/lib/normalize";
import { displayScript } from "@/lib/script";
import { phoneticKey } from "@/lib/translit";
import { centiToDecimal, formatQty, toCenti } from "@/lib/qty";
import { canonicalUnit, storedUnit, unitKey, unitLabel } from "@/lib/units";
import { assertEntryDate, todayIST } from "@/lib/dates";
import { stateForGstin, maskAadhaar } from "@/lib/india";
import { matchMention, type CatalogEntry } from "@/extraction/matcher";
import { lockFirm, stockOf, type Ctx } from "@/ledger/service";
import { recordStock, stockLevels } from "@/stock/service";
import { variantName } from "@/masters/service";
import type { Row } from "./columns";
import { cleanName, parsePhone, parseQty, parseState, parseTaxId, splitAliases } from "./values";

export const MAX_ROWS = 2000;
/** Spelling comparisons are skipped beyond this many row × name pairs (exact matches still work). */
const MAX_FUZZY_PAIRS = 600_000;
/** A close spelling at least this good is offered as "same as …?"; weaker ones are left as new. */
const SUGGEST = 0.85;

export type Status = "new" | "update" | "same" | "choose" | "skip" | "error";

export interface Note {
  code: string;
  /** Extra text for the message: a value, a name, row numbers. */
  detail?: string;
}

export interface Change {
  field: "phone" | "city" | "state" | "taxId" | "alias" | "show" | "low" | "unit";
  from?: string | null;
  to: string;
}

export interface PlanRow {
  /** Sheet row numbers merged into this line (first one identifies it). */
  rows: number[];
  name: string;
  status: Status;
  /** Matched client / item. */
  targetId?: string;
  targetName?: string;
  /** How it matched: gstin, name, alias, choice. */
  matchedBy?: string;
  candidates: { id: string; name: string; score: number }[];
  changes: Change[];
  notes: Note[];
  /** For "error": why it can't be imported. */
  error?: string;
  /** Items: the stock line this row makes. */
  stock?: { unit: string; before: number | null; after: number; change: number };
}

export interface Plan {
  rows: PlanRow[];
  counts: Record<Status, number>;
  /** Stock entry kind if stock changes: count (set to) or receipt (add). */
  stockKind?: "count" | "receipt";
}

/** The person's answer for one line, keyed by its first sheet row number. */
export type Decision = { action: "skip" } | { action: "new" } | { action: "match"; id: string };
export type Decisions = Record<number, Decision>;

export interface ClientOptions {
  /** Replace a client's phone/city/state/tax ID when the sheet differs (default: only fill empty ones). */
  overwrite?: boolean;
}

export interface ItemOptions {
  /** set = the sheet is what's in the godown now (a count); add = goods in; none = don't touch stock. */
  stockMode: "set" | "add" | "none";
  /** Date of the stock entry (today if omitted); never in the future. */
  date?: string;
  /** Unit for new items when the sheet has none. */
  defaultUnit?: string;
}

const tally = (rows: PlanRow[]) => {
  const c: Record<Status, number> = { new: 0, update: 0, same: 0, choose: 0, skip: 0, error: 0 };
  for (const r of rows) c[r.status]++;
  return c;
};

function checkSize(rows: Row[]) {
  if (!rows.length) throw new LedgerError("IMPORT_EMPTY", "No rows to import");
  if (rows.length > MAX_ROWS) throw new LedgerError("IMPORT_TOO_BIG", "Too many rows", { max: MAX_ROWS, rows: rows.length });
}

const short = (s: string | undefined, n = 500) => (s ?? "").slice(0, n);

/** Exact (normalised) lookups by name and extra names, then spelling suggestions within a budget. */
function matcher(catalog: CatalogEntry[], rowsToCompare: number) {
  const exact = new Map<string, Set<string>>();
  const key = (s: string) => normalizeName(displayScript(s)).replace(/\s+/g, "");
  for (const e of catalog) for (const n of [e.name, ...e.aliases]) {
    const k = key(n);
    if (!k) continue;
    const set = exact.get(k) ?? new Set();
    set.add(e.id);
    exact.set(k, set);
  }
  const fuzzyOk = catalog.length * Math.max(1, rowsToCompare) <= MAX_FUZZY_PAIRS;
  return {
    /** Ids whose name or extra name is exactly this. */
    exact: (name: string) => [...(exact.get(key(name)) ?? [])],
    /** Close spellings (never picked automatically). */
    similar: (name: string) => (fuzzyOk ? matchMention({ asWritten: name }, catalog).candidates : []),
    fuzzyOk,
  };
}

// ---------------------------------------------------------------- clients

interface ClientDraft {
  rows: number[];
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  taxIdType: "gstin" | "aadhaar" | null;
  taxId: string | null;
  maskedLast4?: string;
  /** The state was taken from the GSTIN (so it goes if the GSTIN can't be used). */
  stateFromGstin?: boolean;
  aliases: string[];
  notes: Note[];
  error?: string;
}

function parseClient(r: Row): ClientDraft {
  const notes: Note[] = [];
  const name = cleanName(short(r.name));
  const ph = parsePhone(short(r.phone, 100));
  if (ph.phone === null && ph.bad) notes.push({ code: "BAD_PHONE", detail: short(r.phone, 40) });
  if (ph.phone && ph.more) notes.push({ code: "MORE_PHONES" });
  const state = parseState(short(r.state, 80));
  if (r.state && !state) notes.push({ code: "UNKNOWN_STATE", detail: short(r.state, 40) });
  let taxIdType: ClientDraft["taxIdType"] = null;
  let taxId: string | null = null;
  let maskedLast4: string | undefined;
  for (const [raw, hint] of [
    [r.gstin, "gstin"],
    [r.aadhaar, "aadhaar"],
    [r.taxId, "any"],
  ] as const) {
    const t = parseTaxId(short(raw, 60), hint);
    if (!t) continue;
    if (t.type) {
      if (!taxIdType) [taxIdType, taxId] = [t.type, t.value];
      else if (t.value !== taxId) notes.push({ code: "MORE_TAX_IDS" });
    } else if (t.problem === "MASKED") maskedLast4 = t.last4;
    else notes.push({ code: t.problem, detail: short(raw, 30) });
  }
  let st = state;
  let stateFromGstin = false;
  if (taxIdType === "gstin" && taxId) {
    const fromGst = stateForGstin(taxId);
    if (!st) [st, stateFromGstin] = [fromGst, !!fromGst];
    else if (fromGst && fromGst !== st) notes.push({ code: "STATE_GSTIN_MISMATCH", detail: fromGst });
  }
  return {
    rows: [r.rowNo],
    name,
    phone: ph.phone,
    city: cleanName(short(r.city, 80)).slice(0, 80) || null,
    state: st,
    taxIdType,
    taxId,
    maskedLast4,
    stateFromGstin,
    aliases: splitAliases(short(r.aliases)).filter((a) => normalizeName(a) !== normalizeName(name)),
    notes,
    error: name ? undefined : "NO_NAME",
  };
}

/** Rows for the same client (same GSTIN, or same name) become one; the first non-empty value wins. */
function mergeClients(drafts: ClientDraft[]): ClientDraft[] {
  const out: ClientDraft[] = [];
  const byGst = new Map<string, ClientDraft>();
  const byName = new Map<string, ClientDraft>();
  for (const d of drafts) {
    if (d.error) {
      out.push(d);
      continue;
    }
    const nk = normalizeName(displayScript(d.name)).replace(/\s+/g, "");
    const into = (d.taxIdType === "gstin" && d.taxId ? byGst.get(d.taxId) : undefined) ?? byName.get(nk);
    // Same name, different GSTINs: two businesses. Can't tell them apart by name, so the later one is refused.
    if (into && d.taxIdType === "gstin" && into.taxIdType === "gstin" && into.taxId !== d.taxId) {
      out.push({ ...d, error: "SAME_NAME_OTHER_GSTIN", notes: [...d.notes, { code: "SEE_ROW", detail: String(into.rows[0]) }] });
      continue;
    }
    if (!into) {
      out.push(d);
      if (d.taxIdType === "gstin" && d.taxId) byGst.set(d.taxId, d);
      byName.set(nk, d);
      continue;
    }
    into.rows.push(...d.rows);
    for (const f of ["phone", "city", "state"] as const) {
      if (!into[f]) into[f] = d[f];
      else if (d[f] && d[f] !== into[f]) into.notes.push({ code: "CONFLICT", detail: `${f}: ${d[f]} (${d.rows[0]})` });
    }
    if (!into.taxId && d.taxId) [into.taxIdType, into.taxId] = [d.taxIdType, d.taxId];
    if (normalizeName(d.name) !== normalizeName(into.name)) into.aliases.push(d.name);
    into.aliases.push(...d.aliases);
    into.aliases = [...new Set(into.aliases)];
    into.notes.push(...d.notes);
    if (d.taxIdType === "gstin" && d.taxId) byGst.set(d.taxId, into);
    byName.set(nk, into);
  }
  return out;
}

export async function planClients(db: Db, ctx: Ctx, input: Row[], opts: ClientOptions = {}, decisions: Decisions = {}): Promise<Plan> {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can import");
  checkSize(input);
  const [ps, as] = await Promise.all([
    db.select().from(parties).where(eq(parties.companyId, ctx.companyId)),
    db.select().from(partyAliases).where(eq(partyAliases.companyId, ctx.companyId)),
  ]);
  const byId = new Map(ps.map((p) => [p.id, p]));
  const aliasesOf = new Map<string, string[]>();
  for (const a of as) aliasesOf.set(a.partyId, [...(aliasesOf.get(a.partyId) ?? []), a.alias]);
  const aliasOwner = new Map(as.map((a) => [a.normalized, a.partyId]));
  const catalog: CatalogEntry[] = ps.map((p) => ({ id: p.id, name: p.name, aliases: aliasesOf.get(p.id) ?? [] }));
  const byGstin = new Map(ps.filter((p) => p.taxIdType === "gstin" && p.taxId).map((p) => [p.taxId!, p]));
  const byPhone = new Map<string, string[]>();
  for (const p of ps) if (p.phone) byPhone.set(p.phone, [...(byPhone.get(p.phone) ?? []), p.id]);

  const drafts = mergeClients(input.map(parseClient));
  const m = matcher(catalog, drafts.length);
  if (!m.fuzzyOk) drafts[0]?.notes.push({ code: "NO_SPELLING_CHECK" });

  // Names that sound alike within the sheet (Sharma Textile / Sharma Textiles) are flagged, not merged.
  const soundGroups = new Map<string, number[]>();
  for (const d of drafts) if (!d.error) {
    const k = phoneticKey(normalizeName(displayScript(d.name))).replace(/\s+/g, "");
    soundGroups.set(k, [...(soundGroups.get(k) ?? []), d.rows[0]]);
  }
  // A GSTIN can only be planned for one client in this import.
  const gstinClaimed = new Map<string, number>();

  const rows: PlanRow[] = drafts.map((d) => {
    const row: PlanRow = { rows: d.rows, name: d.name || "—", status: "new", candidates: [], changes: [], notes: [...d.notes] };
    if (d.error) return { ...row, status: "error", error: d.error };
    const k = phoneticKey(normalizeName(displayScript(d.name))).replace(/\s+/g, "");
    const alike = (soundGroups.get(k) ?? []).filter((n) => n !== d.rows[0]);
    if (alike.length) row.notes.push({ code: "ALIKE_IN_SHEET", detail: alike.join(", ") });

    // Who is it?
    let target: (typeof ps)[number] | undefined;
    const dec = decisions[d.rows[0]];
    const gstMatch = d.taxIdType === "gstin" && d.taxId ? byGstin.get(d.taxId) : undefined;
    const exactIds = m.exact(d.name);
    if (dec?.action === "skip") return { ...row, status: "skip" };
    if (dec?.action === "match") {
      target = byId.get(dec.id);
      if (!target) return { ...row, status: "error", error: "NOT_FOUND" };
      row.matchedBy = "choice";
    } else if (dec?.action === "new") {
      if (exactIds.length) return { ...row, status: "error", error: "NAME_EXISTS", notes: [...row.notes, { code: "SEE_CLIENT", detail: byId.get(exactIds[0])?.name }] };
    } else if (gstMatch && exactIds.length && !exactIds.includes(gstMatch.id)) {
      // The name says one saved client, the GSTIN another: the person decides.
      row.notes.push({ code: "TAX_ID_TAKEN", detail: gstMatch.name });
      return { ...row, status: "choose", candidates: [gstMatch.id, ...exactIds].map((id) => ({ id, name: byId.get(id)!.name, score: 1 })) };
    } else if (gstMatch) {
      target = gstMatch;
      row.matchedBy = "gstin";
    } else if (exactIds.length === 1) {
      target = byId.get(exactIds[0]);
      row.matchedBy = normalizeName(target!.name) === normalizeName(d.name) ? "name" : "alias";
      // Same name but a different GSTIN on file: probably another business. Ask.
      if (d.taxIdType === "gstin" && target!.taxIdType === "gstin" && target!.taxId !== d.taxId) {
        row.notes.push({ code: "GSTIN_DIFFERS", detail: target!.taxId ?? "" });
        return { ...row, status: "choose", candidates: [{ id: target!.id, name: target!.name, score: 1 }] };
      }
    } else if (exactIds.length > 1) {
      return { ...row, status: "choose", candidates: exactIds.map((id) => ({ id, name: byId.get(id)!.name, score: 1 })) };
    } else {
      const sim = m.similar(d.name);
      const samePhone = d.phone ? (byPhone.get(d.phone) ?? []) : [];
      for (const id of samePhone) if (!sim.some((c) => c.id === id)) sim.push({ id, name: byId.get(id)!.name, score: 0.8 });
      row.candidates = sim.slice(0, 4);
      if (samePhone.length) row.notes.push({ code: "SAME_PHONE", detail: samePhone.map((id) => byId.get(id)!.name).join(", ") });
      if (sim.some((c) => c.score >= SUGGEST) || samePhone.length) return { ...row, status: "choose" };
    }

    // GSTIN claimed by another row of this import, or by another client already.
    const gst = d.taxIdType === "gstin" ? d.taxId : null;
    let useTax = !!d.taxId;
    if (gst) {
      const other = byGstin.get(gst);
      if (other && other.id !== target?.id) {
        row.notes.push({ code: "TAX_ID_TAKEN", detail: other.name });
        useTax = false;
      } else if (gstinClaimed.has(gst) && gstinClaimed.get(gst) !== d.rows[0]) {
        row.notes.push({ code: "TAX_ID_TAKEN", detail: String(gstinClaimed.get(gst)) });
        useTax = false;
      } else gstinClaimed.set(gst, d.rows[0]);
    }
    const state = !useTax && d.stateFromGstin ? null : d.state;

    if (!target) {
      // New client: everything from the sheet.
      row.status = "new";
      if (d.phone) row.changes.push({ field: "phone", to: d.phone });
      if (d.city) row.changes.push({ field: "city", to: d.city });
      if (state) row.changes.push({ field: "state", to: state });
      if (useTax && d.taxId) row.changes.push({ field: "taxId", to: d.taxIdType === "aadhaar" ? maskAadhaar(d.taxId) : d.taxId });
      if (d.maskedLast4 !== undefined) row.notes.push({ code: "MASKED" });
      for (const a of d.aliases) {
        if (aliasOwner.has(normalizeName(a)) || m.exact(a).length) row.notes.push({ code: "ALIAS_TAKEN", detail: a });
        else row.changes.push({ field: "alias", to: a });
      }
      return row;
    }

    // Existing client: fill empty details; differing ones only with "replace".
    row.targetId = target.id;
    row.targetName = target.name;
    const field = (f: "phone" | "city" | "state", v: string | null) => {
      if (!v || v === target![f]) return;
      if (!target![f] || opts.overwrite) row.changes.push({ field: f, from: target![f], to: v });
      else row.notes.push({ code: "KEPT", detail: `${f}: ${target![f]}` });
    };
    field("phone", d.phone);
    field("city", d.city);
    field("state", state);
    if (useTax && d.taxId && d.taxId !== target.taxId) {
      const shown = d.taxIdType === "aadhaar" ? maskAadhaar(d.taxId) : d.taxId;
      const before = target.taxId ? (target.taxIdType === "aadhaar" ? maskAadhaar(target.taxId) : target.taxId) : null;
      if (!target.taxId || opts.overwrite) row.changes.push({ field: "taxId", from: before, to: shown });
      else row.notes.push({ code: "KEPT", detail: `taxId: ${before}` });
    }
    // Masked Aadhaar that is the one on file (e.g. our own export): nothing to do.
    if (d.maskedLast4 !== undefined && !(target.taxIdType === "aadhaar" && target.taxId?.endsWith(d.maskedLast4))) row.notes.push({ code: "MASKED" });
    if (!target.active) row.changes.push({ field: "show", to: "yes" });
    // The sheet's spelling becomes an extra name, so the next slip with it matches by itself.
    const known = new Set([target.name, ...(aliasesOf.get(target.id) ?? [])].map((n) => normalizeName(n)));
    for (const a of [d.name, ...d.aliases]) {
      const n = normalizeName(a);
      if (known.has(n)) continue;
      known.add(n);
      const owner = aliasOwner.get(n) ?? m.exact(a).find((id) => id !== target!.id);
      if (owner && owner !== target.id) row.notes.push({ code: "ALIAS_TAKEN", detail: a });
      else row.changes.push({ field: "alias", to: a });
    }
    row.status = row.changes.length ? "update" : "same";
    return row;
  });
  return { rows, counts: tally(rows) };
}

/** Plans again with the person's choices and saves it all in one go. Same `importId` twice saves once. */
export async function applyClients(db: Db, ctx: Ctx, importId: string, input: Row[], opts: ClientOptions, decisions: Decisions) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can import");
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    const done = await previousImport(tx, ctx, importId);
    if (done) return done;
    const plan = await planClients(tx, ctx, input, opts, decisions);
    const drafts = new Map(mergeClients(input.map(parseClient)).map((d) => [d.rows[0], d]));
    let created = 0;
    let updated = 0;
    for (const r of plan.rows) {
      if (r.status !== "new" && r.status !== "update") continue;
      const d = drafts.get(r.rows[0])!;
      const has = (f: Change["field"]) => r.changes.some((c) => c.field === f);
      const tax = has("taxId") ? { taxIdType: d.taxIdType, taxId: d.taxId } : {};
      let id = r.targetId;
      if (!id) {
        const [p] = await tx
          .insert(parties)
          .values({ companyId: ctx.companyId, name: d.name, phone: d.phone, city: d.city, state: has("state") ? d.state : null, ...tax, createdBy: ctx.userId, createdAt: ctx.now })
          .returning({ id: parties.id });
        id = p.id;
        created++;
      } else {
        const set: Partial<typeof parties.$inferInsert> = { ...tax };
        if (has("phone")) set.phone = d.phone;
        if (has("city")) set.city = d.city;
        if (has("state")) set.state = d.state;
        if (has("show")) set.active = true;
        if (Object.keys(set).length) await tx.update(parties).set(set).where(and(eq(parties.id, id), eq(parties.companyId, ctx.companyId)));
        updated++;
      }
      for (const c of r.changes.filter((c) => c.field === "alias")) {
        await tx.insert(partyAliases).values({ companyId: ctx.companyId, partyId: id, alias: c.to, normalized: normalizeName(c.to), createdBy: ctx.userId }).onConflictDoNothing();
      }
    }
    const summary = { kind: "clients" as const, created, updated, counts: plan.counts };
    await tx.insert(auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action: "import.clients", entityType: "import", entityId: importId, details: summary });
    return { ...summary, duplicate: false, plan };
  });
}

async function previousImport(tx: Db, ctx: Ctx, importId: string) {
  const [prev] = await tx
    .select({ details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.companyId, ctx.companyId), eq(auditLog.entityType, "import"), eq(auditLog.entityId, importId)));
  return prev ? { ...(prev.details as { kind: "clients" | "items"; created: number; updated: number }), duplicate: true as const } : null;
}

// ---------------------------------------------------------------- items

interface ItemDraft {
  rows: number[];
  product: string;
  variant: string | null;
  name: string;
  unit: string | null;
  qty: number | null;
  low: number | null;
  aliases: string[];
  notes: Note[];
  error?: string;
}

function parseItem(r: Row, opts: ItemOptions): ItemDraft {
  const notes: Note[] = [];
  const product = cleanName(short(r.item));
  const variant = [cleanName(short(r.colour, 60)), cleanName(short(r.size, 30))].filter(Boolean).join(" ") || null;
  const name = product ? (variant ? variantName(product, variant) : product) : "";
  let unit = r.unit ? canonicalUnit(short(r.unit, 30)) || null : null;
  let qty: number | null = null;
  let error: string | undefined = product ? undefined : "NO_NAME";
  if (opts.stockMode !== "none" && r.qty !== undefined) {
    const q = parseQty(short(r.qty, 40));
    if (!q.ok) error ??= q.reason;
    else if (!("empty" in q)) {
      if (q.unit) {
        if (!unit) unit = q.unit;
        else if (q.unit !== unit) notes.push({ code: "UNIT_IN_QTY", detail: q.unit });
      }
      // Below zero: refused later unless it is exactly the stock now (a sheet we exported, re-imported).
      qty = q.centi;
      if (q.centi < 0 && opts.stockMode === "add") error ??= "NEGATIVE_ADD";
    }
  }
  let low: number | null = null;
  if (r.low !== undefined) {
    const l = parseQty(short(r.low, 40));
    if (l.ok && !("empty" in l) && l.centi >= 0) low = l.centi;
    else if (!(l.ok && "empty" in l)) notes.push({ code: "BAD_LOW", detail: short(r.low, 20) });
  }
  return { rows: [r.rowNo], product, variant, name, unit, qty, low, aliases: splitAliases(short(r.aliases)), notes, error };
}

/** The same item (and unit) on several rows: quantities add up (stock kept in two places is still stock). */
function mergeItems(drafts: ItemDraft[]): ItemDraft[] {
  const out: ItemDraft[] = [];
  const seen = new Map<string, ItemDraft>();
  for (const d of drafts) {
    if (d.error) {
      out.push(d);
      continue;
    }
    const k = `${normalizeName(displayScript(d.name)).replace(/\s+/g, "")}|${d.unit ?? ""}`;
    const into = seen.get(k);
    if (!into) {
      seen.set(k, d);
      out.push(d);
      continue;
    }
    into.rows.push(...d.rows);
    if (d.qty !== null) into.qty = (into.qty ?? 0) + d.qty;
    if (d.low !== null) into.low ??= d.low;
    into.aliases = [...new Set([...into.aliases, ...d.aliases])];
    into.notes.push(...d.notes);
  }
  for (const d of out) if (d.rows.length > 1) d.notes.push({ code: "ADDED_UP", detail: d.rows.join(", ") });
  return out;
}

export async function planItems(db: Db, ctx: Ctx, input: Row[], opts: ItemOptions, decisions: Decisions = {}): Promise<Plan> {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can import");
  checkSize(input);
  const date = opts.date ?? todayIST(ctx.now);
  if (opts.stockMode !== "none") assertEntryDate(date, ctx.now);
  const stockId = stockOf(ctx);
  const [its, as, levels] = await Promise.all([
    db.select().from(items).where(eq(items.companyId, stockId)),
    db.select().from(itemAliases).where(eq(itemAliases.companyId, stockId)),
    stockLevels(db, stockId),
  ]);
  const byId = new Map(its.map((i) => [i.id, i]));
  const aliasesOf = new Map<string, string[]>();
  for (const a of as) aliasesOf.set(a.itemId, [...(aliasesOf.get(a.itemId) ?? []), a.alias]);
  const aliasOwner = new Map(as.map((a) => [a.normalized, a.itemId]));
  const catalog: CatalogEntry[] = its.map((i) => ({ id: i.id, name: i.name, aliases: aliasesOf.get(i.id) ?? [], unit: i.unit }));
  const productUnit = new Map(its.map((i) => [normalizeName(i.product ?? i.name), i.unit]));

  const drafts = mergeItems(input.map((r) => parseItem(r, opts)));
  const m = matcher(catalog, drafts.length);
  if (!m.fuzzyOk) drafts[0]?.notes.push({ code: "NO_SPELLING_CHECK" });
  // Two lines ending up on the same item and unit (e.g. "D-4012" and "4012"): stock adds up, said once.
  const stockLine = new Map<string, number>();

  const rows: PlanRow[] = [];
  const planOne = (draft: ItemDraft): PlanRow => {
    let d = draft;
    const row: PlanRow = { rows: d.rows, name: d.name || "—", status: "new", candidates: [], changes: [], notes: [...d.notes] };
    if (d.error) return { ...row, status: "error", error: d.error };
    const dec = decisions[d.rows[0]];
    if (dec?.action === "skip") return { ...row, status: "skip" };
    const exactIds = m.exact(d.name).concat(d.variant ? m.exact(`${d.product} ${d.variant}`) : []).filter((v, i, a) => a.indexOf(v) === i);
    let target: (typeof its)[number] | undefined;
    if (dec?.action === "match") {
      target = byId.get(dec.id);
      if (!target) return { ...row, status: "error", error: "NOT_FOUND" };
      row.matchedBy = "choice";
    } else if (dec?.action === "new") {
      if (exactIds.length) return { ...row, status: "error", error: "NAME_EXISTS", notes: [...row.notes, { code: "SEE_ITEM", detail: byId.get(exactIds[0])?.name }] };
    } else if (exactIds.length === 1) {
      target = byId.get(exactIds[0]);
      row.matchedBy = normalizeName(target!.name) === normalizeName(d.name) ? "name" : "alias";
    } else if (exactIds.length > 1) {
      return { ...row, status: "choose", candidates: exactIds.map((id) => ({ id, name: byId.get(id)!.name, score: 1 })) };
    } else {
      // Another colour/size of the same product is surely another item, however alike the names look.
      const otherVariant = (id: string) => {
        const it = byId.get(id)!;
        return !!d.variant && normalizeName(it.product ?? it.name) === normalizeName(d.product) && normalizeName(it.variant ?? "") !== normalizeName(d.variant);
      };
      row.candidates = m.similar(d.name).filter((c) => !otherVariant(c.id)).slice(0, 4);
      if (row.candidates.some((c) => c.score >= SUGGEST)) return { ...row, status: "choose" };
    }

    // Unit: an existing item keeps its own; a packing unit (dabba…) is stock in that unit; anything else doesn't fit.
    let itemUnit: string;
    let lineUnit: string | null = null;
    if (target) {
      itemUnit = target.unit;
      const u = storedUnit(d.unit, target.unit);
      if (u === undefined) return { ...row, status: "error", error: "UNIT_MISMATCH", targetId: target.id, targetName: target.name, notes: [...row.notes, { code: "ITEM_UNIT", detail: `${d.unit} ≠ ${target.unit}` }] };
      lineUnit = u;
    } else {
      const sibling = productUnit.get(normalizeName(d.product));
      itemUnit = d.unit ?? sibling ?? canonicalUnit(opts.defaultUnit || "pcs");
      if (!d.unit && !sibling) row.notes.push({ code: "UNIT_DEFAULTED", detail: itemUnit });
      row.changes.push({ field: "unit", to: itemUnit });
    }

    if (target) {
      row.targetId = target.id;
      row.targetName = target.name;
      if (!target.active) row.changes.push({ field: "show", to: "yes" });
      if (d.low !== null && d.low !== toCenti(target.lowStockLevel)) row.changes.push({ field: "low", from: formatQty(toCenti(target.lowStockLevel)), to: formatQty(d.low) });
    } else if (d.low !== null) row.changes.push({ field: "low", to: formatQty(d.low) });

    const known = new Set((target ? [target.name, ...(aliasesOf.get(target.id) ?? [])] : [d.name]).map((n) => normalizeName(n)));
    for (const a of [...(target ? [d.name] : []), ...d.aliases]) {
      const n = normalizeName(a);
      if (known.has(n)) continue;
      known.add(n);
      const owner = aliasOwner.get(n) ?? m.exact(a).find((id) => id !== target?.id);
      if (owner && owner !== target?.id) row.notes.push({ code: "ALIAS_TAKEN", detail: a });
      else row.changes.push({ field: "alias", to: a });
    }

    if (d.qty !== null && d.qty < 0) {
      const now = target ? (levels.get(unitKey(target.id, lineUnit))?.inStock ?? 0) : 0;
      if (!target || now !== d.qty) return { ...row, status: "error", error: "NEGATIVE_COUNT" };
      d = { ...d, qty: null };
    }
    if (d.qty !== null && opts.stockMode !== "none" && !(opts.stockMode === "add" && d.qty === 0)) {
      const k = target ? unitKey(target.id, lineUnit) : `new|${normalizeName(d.name)}|${lineUnit ?? ""}`;
      const earlier = stockLine.get(k);
      const before = target ? (levels.get(unitKey(target.id, lineUnit))?.inStock ?? 0) : null;
      if (earlier !== undefined) {
        // Already counted on another line of this sheet: add them up there.
        const first = rows.find((x) => x.rows[0] === earlier);
        if (first?.stock) {
          first.stock.after += d.qty;
          first.stock.change += d.qty;
          first.notes.push({ code: "ADDED_UP", detail: d.rows.join(", ") });
        }
        row.notes.push({ code: "STOCK_ON_ROW", detail: String(earlier) });
      } else {
        stockLine.set(k, d.rows[0]);
        const after = opts.stockMode === "set" ? d.qty : (before ?? 0) + d.qty;
        row.stock = { unit: unitLabel(lineUnit, itemUnit), before, after, change: after - (before ?? 0) };
      }
    }
    row.status = target ? (row.changes.length || (row.stock && row.stock.change !== 0) ? "update" : "same") : "new";
    return row;
  };
  for (const d of drafts) rows.push(planOne(d));
  // Lines merged into an earlier line's stock above are pushed after `rows` is built; recount.
  for (const r of rows) if (r.status === "same" && r.stock && r.stock.change !== 0) r.status = "update";
  const changesStock = rows.some((r) => (r.status === "new" || r.status === "update") && r.stock && (opts.stockMode === "set" || r.stock.change !== 0));
  return { rows, counts: tally(rows), stockKind: changesStock ? (opts.stockMode === "set" ? "count" : "receipt") : undefined };
}

/** Plans again with the person's choices, creates items, sets levels and records one stock entry. Same `importId` twice saves once. */
export async function applyItems(db: Db, ctx: Ctx, importId: string, input: Row[], opts: ItemOptions, decisions: Decisions, label?: string) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can import");
  const stockId = stockOf(ctx);
  return db.transaction(async (tx) => {
    await lockFirm(tx, ctx);
    const done = await previousImport(tx, ctx, importId);
    if (done) return done;
    const plan = await planItems(tx, ctx, input, opts, decisions);
    const drafts = new Map(mergeItems(input.map((r) => parseItem(r, opts))).map((d) => [d.rows[0], d]));
    let created = 0;
    let updated = 0;
    const lines: { itemId: string; quantity: string; unit: string | null }[] = [];
    const ids = new Map<number, string>();
    for (const r of plan.rows) {
      if (r.status !== "new" && r.status !== "update" && r.status !== "same") continue;
      const d = drafts.get(r.rows[0])!;
      let id = r.targetId;
      const low = r.changes.find((c) => c.field === "low");
      if (!id) {
        if (r.status !== "new") continue;
        const unit = r.changes.find((c) => c.field === "unit")!.to;
        const [it] = await tx
          .insert(items)
          .values({
            companyId: stockId,
            name: d.name,
            unit,
            product: d.product,
            variant: d.variant,
            lowStockLevel: centiToDecimal(d.low ?? 1000),
            createdBy: ctx.userId,
            createdAt: ctx.now,
          })
          .returning({ id: items.id });
        id = it.id;
        created++;
      } else if (r.status === "update") {
        const set: Partial<typeof items.$inferInsert> = {};
        if (low) set.lowStockLevel = centiToDecimal(d.low!);
        if (r.changes.some((c) => c.field === "show")) set.active = true;
        if (Object.keys(set).length) await tx.update(items).set(set).where(and(eq(items.id, id), eq(items.companyId, stockId)));
        updated++;
      }
      ids.set(r.rows[0], id);
      for (const c of r.changes.filter((c) => c.field === "alias")) {
        await tx.insert(itemAliases).values({ companyId: stockId, itemId: id, alias: c.to, normalized: normalizeName(c.to), createdBy: ctx.userId }).onConflictDoNothing();
      }
      if (r.stock && (r.status === "new" || r.status === "update") && (opts.stockMode === "set" || r.stock.change !== 0)) {
        const its = await tx.select({ unit: items.unit }).from(items).where(inArray(items.id, [id]));
        const lineUnit = storedUnit(d.unit, its[0].unit) ?? null;
        const qty = opts.stockMode === "set" ? r.stock.after : r.stock.change;
        lines.push({ itemId: id, quantity: centiToDecimal(qty), unit: lineUnit });
      }
    }
    let batchId: string | null = null;
    if (lines.length && plan.stockKind) {
      const res = await recordStock(tx, ctx, {
        captureId: `import-${importId}`,
        kind: plan.stockKind,
        date: opts.date ?? todayIST(ctx.now),
        lines,
        reason: label ? `Excel: ${label}`.slice(0, 200) : "Excel",
        channel: "app",
        inputMethod: "form",
      });
      batchId = res.batchId;
    }
    const summary = { kind: "items" as const, created, updated, stockLines: lines.length, stockKind: plan.stockKind ?? null, batchId, counts: plan.counts };
    await tx.insert(auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action: "import.items", entityType: "import", entityId: importId, details: summary });
    return { ...summary, duplicate: false, plan };
  });
}
