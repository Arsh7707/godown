/**
 * Units as people say them ("piece", "mtr", "डिब्बा", "ਬੋਰੇ") reduced to one name.
 * Packing units (nag, dabba, bora, thaan) are not pieces: for now the user
 * types the piece count by hand when one is said (see EntryForm).
 */
import { normalizeName } from "./normalize";

const UNIT_SYNONYMS: Record<string, string> = {
  pc: "pcs",
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  peace: "pcs",
  m: "meter",
  mtr: "meter",
  mtrs: "meter",
  meter: "meter",
  meters: "meter",
  metre: "meter",
  metres: "meter",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  than: "thaan",
  thaan: "thaan",
  thans: "thaan",
  // Hindi (Devanagari) and Punjabi (Gurmukhi) spellings
  "पीस": "pcs",
  // nag is a packing unit (e.g. 1 nag = 12 pcs), not a piece
  nag: "nag",
  nags: "nag",
  "नग": "nag",
  "नंग": "nag",
  "ਨਗ": "nag",
  "ਪੀਸ": "pcs",
  "मीटर": "meter",
  "ਮੀਟਰ": "meter",
  "किलो": "kg",
  "ਕਿਲੋ": "kg",
  "थान": "thaan",
  // Packages
  bora: "bora",
  bore: "bora",
  boras: "bora",
  bori: "bora",
  "बोरा": "bora",
  "बोरे": "bora",
  "बोरी": "bora",
  "ਬੋਰਾ": "bora",
  "ਬੋਰੇ": "bora",
  "ਬੋਰੀ": "bora",
  dabba: "dabba",
  dibba: "dabba",
  box: "dabba",
  boxes: "dabba",
  carton: "dabba",
  "डिब्बा": "dabba",
  "डब्बा": "dabba",
  "ਡੱਬਾ": "dabba",
  "ਡੱਬੇ": "dabba",
  "ਥਾਨ": "thaan",
};
export const canonicalUnit = (u: string) => {
  const n = normalizeName(u).replace(/\s+/g, "");
  return UNIT_SYNONYMS[n] ?? n;
};


export const sameUnit = (a: string, b: string) => canonicalUnit(a) === canonicalUnit(b);

export const PACKING_UNITS = ["nag", "dabba", "bora", "thaan"] as const;
const PACKING = new Set<string>(PACKING_UNITS);

/**
 * True when what was said can't be saved as-is and the piece count must be
 * typed: the unit differs from the item's, or (item not known yet) it is a
 * packing unit.
 */
export function needsPieces(unitSaid: string | null | undefined, itemUnit: string | null | undefined): boolean {
  if (!unitSaid) return false;
  if (itemUnit) return !sameUnit(unitSaid, itemUnit);
  return PACKING.has(canonicalUnit(unitSaid));
}

/**
 * How a line's unit is stored: null when it is the item's own unit, else the
 * canonical packing unit ("dabba"). Units are saved as said, never converted.
 * Returns undefined for a unit that is neither (e.g. "meter" for a pcs item).
 */
export function storedUnit(unit: string | null | undefined, itemUnit: string): string | null | undefined {
  if (!unit || !unit.trim()) return null;
  if (sameUnit(unit, itemUnit)) return null;
  const c = canonicalUnit(unit);
  return PACKING.has(c) ? c : undefined;
}

/** Choices for the unit dropdown: the item's own unit first, then packing units. */
export function unitChoices(itemUnit: string): { value: string | null; label: string }[] {
  return [{ value: null, label: itemUnit }, ...PACKING_UNITS.filter((u) => !sameUnit(u, itemUnit)).map((u) => ({ value: u, label: u }))];
}

/** What to show: the line's unit, or the item's own. */
export const unitLabel = (unit: string | null | undefined, itemUnit: string) => unit ?? itemUnit;

/** Key for balances/stock per item and unit. */
export const unitKey = (itemId: string, unit: string | null | undefined) => `${itemId}|${unit ?? ""}`;
