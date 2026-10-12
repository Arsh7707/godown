/**
 * Turns model output into a form pre-fill plus a list of issues for the
 * user to resolve. Pure: no I/O.
 */
import { assertEntryDate, isValidDate } from "@/lib/dates";
import { formatQty, toPositiveCenti } from "@/lib/qty";
import { displayScript } from "@/lib/script";
import { canonicalUnit, PACKING_UNITS, storedUnit } from "@/lib/units";
import { matchMention } from "./matcher";
import type { Entry, EntryKind, ModelOutput } from "./schema";
import type { Catalog, Draft, DraftEntry, DraftLine, Issue } from "./types";

export interface EntryContext {
  today: string;
  now: Date;
  sourceText: string | null;
  /** Date for entries that don't say one: today, or a past day picked in History. */
  defaultDate?: string;
}

export function emptyDraft(kind: EntryKind, today: string, sourceText: string | null): Draft {
  return {
    kind,
    party: { status: "missing", mention: null, candidates: [] },
    lines: [],
    entryDate: today,
    entryDateStated: false,
    promisedDate: null,
    takenBy: null,
    transport: null,
    lrNumber: null,
    notes: null,
    sourceText,
    language: null,
    summary: null,
  };
}


/** One party's entry → form pre-fill + issues. Line issues carry the line index. */
function buildEntry(
  kind: EntryKind,
  e: Entry,
  language: ModelOutput["language"],
  catalog: Catalog,
  ctx: EntryContext,
): DraftEntry {
  const issues: Issue[] = [];
  const fallbackDate = ctx.defaultDate ?? ctx.today;
  const draft = emptyDraft(kind, fallbackDate, ctx.sourceText);
  draft.language = language;
  draft.summary = displayScript(e.summary.trim()) || null;
  draft.notes = e.notes?.trim() ? displayScript(e.notes.trim()) : null;

  // Party (stock has none)
  if (kind !== "stock") {
    draft.party = matchMention(e.party && { asWritten: e.party.as_written, latin: e.party.latin, catalogGuess: e.party.catalog_guess }, catalog.parties);
    if (draft.party.status === "missing") issues.push({ code: "PARTY_MISSING", blocking: true });
    if (draft.party.status === "choose") issues.push({ code: "PARTY_UNCERTAIN", blocking: true, detail: draft.party.mention });
  }

  // Lines
  if (!e.lines.length) issues.push({ code: "NO_LINES", blocking: true });
  e.lines.forEach((l, i) => {
    const item = matchMention({ asWritten: l.item.as_written, latin: l.item.latin, catalogGuess: l.item.catalog_guess }, catalog.items);
    const line: DraftLine = { item, quantity: null, quantityAsWritten: l.quantity_as_written, unitSaid: l.unit, unitExpected: null, unit: null };
    if (item.status !== "matched") issues.push({ code: "ITEM_UNCERTAIN", blocking: true, line: i, detail: item.mention ?? undefined });
    else line.unitExpected = catalog.items.find((c) => c.id === item.id)?.unit ?? null;

    if (l.quantity === null) {
      issues.push({ code: "QTY_MISSING", blocking: true, line: i });
    } else {
      try {
        line.quantity = formatQty(toPositiveCenti(String(l.quantity)));
      } catch {
        issues.push({ code: "QTY_INVALID", blocking: true, line: i, detail: String(l.quantity) });
      }
    }
    // Packing units (nag, dabba, bora, thaan) are saved as said; any other different unit needs a person.
    const stored = line.unitExpected ? storedUnit(l.unit, line.unitExpected) : l.unit && PACKING_UNITS.includes(canonicalUnit(l.unit) as (typeof PACKING_UNITS)[number]) ? canonicalUnit(l.unit) : null;
    if (stored === undefined) issues.push({ code: "UNIT_MISMATCH", blocking: true, line: i, detail: `${l.unit} ≠ ${line.unitExpected}` });
    else line.unit = stored;
    draft.lines.push(line);
  });

  // Dates
  if (e.entry_date.iso) {
    if (!isValidDate(e.entry_date.iso)) {
      issues.push({ code: "DATE_INVALID", blocking: true, detail: e.entry_date.as_written ?? e.entry_date.iso });
    } else {
      try {
        assertEntryDate(e.entry_date.iso, ctx.now);
        draft.entryDate = e.entry_date.iso;
        draft.entryDateStated = true;
      } catch {
        // A date in the future can't be right: keep today's (or the chosen day's) date and say so.
        issues.push({ code: "ENTRY_DATE_FUTURE", blocking: false, detail: e.entry_date.as_written ?? e.entry_date.iso });
      }
    }
  }
  if (kind === "order" && e.promised_date.iso) {
    if (isValidDate(e.promised_date.iso)) draft.promisedDate = e.promised_date.iso;
    else issues.push({ code: "DATE_INVALID", blocking: false, detail: e.promised_date.as_written ?? e.promised_date.iso });
  }
  if (kind === "dispatch") {
    draft.takenBy = e.taken_by;
    draft.transport = e.transport;
    draft.lrNumber = e.lr_number;
  }
  return { draft, issues, readyToConfirm: !issues.some((i) => i.blocking) };
}

/**
 * Two entries for the same (auto-matched) party with the same dates become
 * one entry with all the lines, so a party's items stay together.
 */
function mergeSameParty(entries: DraftEntry[]): DraftEntry[] {
  const out: DraftEntry[] = [];
  for (const e of entries) {
    const p = e.draft.party;
    const target =
      p.status === "matched"
        ? out.find(
            (o) =>
              o.draft.party.status === "matched" &&
              o.draft.party.id === p.id &&
              o.draft.entryDate === e.draft.entryDate &&
              o.draft.promisedDate === e.draft.promisedDate,
          )
        : undefined;
    if (!target) {
      out.push(e);
      continue;
    }
    const offset = target.draft.lines.length;
    target.draft.lines.push(...e.draft.lines);
    target.issues.push(
      ...e.issues.filter((i) => i.line !== undefined || !target.issues.some((t) => t.code === i.code)).map((i) => (i.line === undefined ? i : { ...i, line: i.line + offset })),
    );
    target.draft.notes = [target.draft.notes, e.draft.notes].filter(Boolean).join("; ") || null;
    for (const k of ["takenBy", "transport", "lrNumber"] as const) target.draft[k] = target.draft[k] ?? e.draft[k];
    target.readyToConfirm = !target.issues.some((i) => i.blocking);
  }
  return out;
}

export function buildEntries(
  kind: EntryKind,
  out: ModelOutput,
  catalog: Catalog,
  ctx: EntryContext,
): { entries: DraftEntry[]; issues: Issue[] } {
  const issues: Issue[] = [];
  for (const u of out.unreadable) issues.push({ code: "UNREADABLE", blocking: false, detail: displayScript(u) });
  if (!out.is_relevant || !out.entries.length) {
    issues.unshift({ code: "NOT_RELEVANT", blocking: true });
    return { entries: [], issues };
  }
  return { entries: mergeSameParty(out.entries.map((e) => buildEntry(kind, e, out.language, catalog, ctx))), issues };
}
