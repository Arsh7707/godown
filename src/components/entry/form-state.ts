import type { Candidate } from "@/extraction/matcher";
import type { Draft } from "@/extraction/types";
import type { InputMethod } from "@/ledger/service";
import { storedUnit } from "@/lib/units";

/** What is being entered: an order, a dispatch, goods coming in, or a stock count. */
export type FormKind = "order" | "dispatch" | "receipt" | "count";
export const isStock = (k: FormKind): k is "receipt" | "count" => k === "receipt" || k === "count";
/** The extraction pipeline reads both stock kinds the same way. */
export const extractionKind = (k: FormKind) => (isStock(k) ? "stock" : k);
export const saveUrl = (k: FormKind) => (k === "order" ? "/api/orders" : k === "dispatch" ? "/api/dispatches" : "/api/stock");

export interface FormLine {
  key: string;
  /** Set when editing an existing order line. */
  orderLineId?: string;
  itemId: string | null;
  /** What was read/heard, shown when the item still needs picking. */
  mention: string | null;
  candidates: Candidate[];
  quantity: string;
  unitSaid: string | null;
  /** Unit to save, chosen in the dropdown: null = the item's own unit, or "nag" / "dabba" / "bora" / "thaan". */
  unit?: string | null;
}

export interface FormState {
  partyId: string | null;
  partyMention: string | null;
  partyCandidates: Candidate[];
  date: string;
  promisedDate: string;
  takenBy: string;
  transport: string;
  lrNumber: string;
  notes: string;
  lines: FormLine[];
}

/** Where the entry came from: saved with it. */
export interface EntrySource {
  /** Stable per entry so retries never save twice. */
  entryCaptureId: string;
  captureId: string | null;
  inputMethod: InputMethod;
  sourceAttachmentId: string | null;
  sourceText: string | null;
  /** Plain-English summary from reading, shown in place of the raw transcript. */
  summaryEn?: string | null;
}

let k = 0;
export const lineKey = () => `l${++k}`;

export const emptyLine = (): FormLine => ({ key: lineKey(), itemId: null, mention: null, candidates: [], quantity: "", unitSaid: null });

export function emptyForm(today: string): FormState {
  return { partyId: null, partyMention: null, partyCandidates: [], date: today, promisedDate: "", takenBy: "", transport: "", lrNumber: "", notes: "", lines: [emptyLine()] };
}

export function formFromDraft(d: Draft): FormState {
  return {
    partyId: d.party.status === "matched" ? d.party.id : null,
    partyMention: d.party.mention,
    partyCandidates: d.party.candidates,
    date: d.entryDate,
    promisedDate: d.promisedDate ?? "",
    takenBy: d.takenBy ?? "",
    transport: d.transport ?? "",
    lrNumber: d.lrNumber ?? "",
    notes: d.notes ?? "",
    lines: d.lines.length
      ? d.lines.map((l) => {
          // The unit read from the slip / voice note is preset in the dropdown; saved as said.
          return {
            key: lineKey(),
            itemId: l.item.status === "matched" ? l.item.id : null,
            mention: l.item.mention,
            candidates: l.item.candidates,
            quantity: l.quantity ?? "",
            unitSaid: l.unitSaid,
            unit: l.unit ?? null,
          };
        })
      : [emptyLine()],
  };
}

export function payload(kind: FormKind, f: FormState, src: EntrySource, applyUnmatched: boolean) {
  return {
    ...(isStock(kind) ? { kind } : {}),
    entryCaptureId: src.entryCaptureId,
    captureId: src.captureId,
    inputMethod: src.inputMethod,
    sourceAttachmentId: src.sourceAttachmentId,
    sourceText: src.sourceText,
    partyId: f.partyId,
    date: f.date,
    promisedDate: kind === "order" ? f.promisedDate || null : null,
    takenBy: kind === "dispatch" ? f.takenBy.trim() || null : null,
    transport: kind === "dispatch" ? f.transport.trim() || null : null,
    lrNumber: kind === "dispatch" ? f.lrNumber.trim() || null : null,
    notes: f.notes.trim() || null,
    applyUnmatched,
    lines: f.lines
      .filter((l) => l.itemId && l.quantity.trim())
      .map((l) => ({ itemId: l.itemId!, quantity: l.quantity.trim(), unit: l.unit ?? null, ...(l.orderLineId ? { orderLineId: l.orderLineId } : {}) })),
  };
}

/** A quantity the form accepts: up to 2 decimals, more than 0 (a stock count may be 0). */
export const qtyValid = (q: string, kind: FormKind) => /^\d+(\.\d{1,2})?$/.test(q.trim()) && (Number(q) > 0 || kind === "count");

export const formComplete = (f: FormState, kind: FormKind = "order") =>
  (isStock(kind) || !!f.partyId) &&
  !!f.date &&
  f.lines.some((l) => l.itemId && l.quantity.trim()) &&
  f.lines.every((l) => (!l.itemId && !l.quantity.trim()) || (l.itemId && qtyValid(l.quantity, kind)));

/** After picking an item: preset its unit from what was said, if that unit fits the item. */
export function unitForPick(unitSaid: string | null, itemUnit: string): string | null {
  return storedUnit(unitSaid, itemUnit) ?? null;
}
