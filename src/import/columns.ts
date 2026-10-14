/**
 * Reading a spreadsheet's layout: which row holds the headings, which column
 * is which field, and whether the sheet lists clients or items. Pure; runs in
 * the browser (to show the mapping) and on the server (in tests).
 *
 * Sheets come from Tally, Busy, Vyapar, Marg, Google Sheets or by hand:
 * headings in English, Hinglish or Hindi, title rows above them, blank rows
 * and "Total" rows in between.
 */
export type ImportKind = "clients" | "items";

export const CLIENT_FIELDS = ["name", "phone", "city", "state", "gstin", "aadhaar", "taxId", "aliases"] as const;
export const ITEM_FIELDS = ["item", "colour", "size", "unit", "qty", "low", "aliases"] as const;
export type ClientField = (typeof CLIENT_FIELDS)[number];
export type ItemField = (typeof ITEM_FIELDS)[number];
export type Field = ClientField | ItemField;

/** Field → column index (0-based), or absent. */
export type Mapping = Partial<Record<Field, number>>;

/** Headings as written, squashed (lower case, letters and digits only). */
const SYNONYMS: Record<Field, string[]> = {
  name: ["name", "partyname", "party", "client", "clientname", "customer", "customername", "buyer", "buyername", "firmname", "account", "accountname", "ledger", "ledgername", "dealer", "dealername", "shop", "shopname", "naam", "partykanaam", "नाम", "पार्टी", "पार्टीकानाम", "ग्राहक", "फर्म", "grahak", "ਨਾਮ", "ਪਾਰਟੀ"],
  phone: ["phone", "phoneno", "phonenumber", "mobile", "mobileno", "mobilenumber", "mob", "mobno", "contact", "contactno", "contactnumber", "whatsapp", "whatsappno", "whatsappnumber", "cell", "cellno", "tel", "telephone", "फोन", "फ़ोन", "मोबाइल", "मोबाइलनंबर", "ਫ਼ੋਨ", "ਮੋਬਾਈਲ"],
  city: ["city", "town", "place", "location", "shehar", "sheher", "शहर", "station", "district", "area", "ਸ਼ਹਿਰ"],
  state: ["state", "statename", "राज्य", "rajya", "province", "ਰਾਜ"],
  gstin: ["gstin", "gst", "gstno", "gstnumber", "gstinno", "gstinuin", "gstregno", "gstregistrationno", "जीएसटी", "जीएसटीनंबर"],
  aadhaar: ["aadhaar", "aadhar", "adhar", "aadhaarno", "aadharno", "aadharnumber", "aadhaarnumber", "uid", "uidai", "आधार", "आधारनंबर", "ਆਧਾਰ"],
  taxId: ["taxid", "taxno", "taxnumber", "registration", "registrationno", "regno"],
  aliases: ["alias", "aliases", "othername", "othernames", "alsoknownas", "aka", "shortname", "nickname", "उपनाम"],
  item: ["item", "items", "itemname", "product", "productname", "design", "designno", "designnumber", "designname", "article", "articleno", "quality", "description", "particulars", "stockitem", "nameofitem", "sku", "maal", "सामान", "माल", "आइटम", "डिज़ाइन", "डिजाइन", "ਮਾਲ", "ਆਈਟਮ"],
  colour: ["colour", "color", "colourname", "colorname", "shade", "rang", "रंग", "ਰੰਗ"],
  size: ["size", "साइज़", "साइज", "ਸਾਈਜ਼"],
  unit: ["unit", "units", "uom", "per", "unitname", "इकाई", "यूनिट", "ਯੂਨਿਟ"],
  qty: ["qty", "quantity", "stock", "closing", "closingstock", "closingqty", "closingbalance", "balance", "balanceqty", "instock", "available", "availableqty", "pcs", "pieces", "nag", "count", "onhand", "currentstock", "stockqty", "मात्रा", "स्टॉक", "ਸਟਾਕ", "ਮਾਤਰਾ"],
  low: ["low", "lowstock", "lowlevel", "minimum", "min", "minstock", "minqty", "minimumstock", "reorder", "reorderlevel", "reorderqty", "alert", "alertlevel", "safetystock"],
};

export const squash = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

/** How well one heading fits one field: 2 = exact, 1 = contains a long synonym, 0 = no. */
function fit(heading: string, field: Field): number {
  const h = squash(heading);
  if (!h) return 0;
  if (SYNONYMS[field].includes(h)) return 2;
  // "Party Name (as per GST)", "Mobile No. 1", "Closing Stock Qty", "Qty (pcs)"
  if (h.length <= 40 && SYNONYMS[field].some((syn) => (syn.length >= 4 && h.includes(syn)) || (syn.length >= 3 && h.startsWith(syn)))) return 1;
  return 0;
}

/**
 * Tie order for partial matches: specific fields first, the name last, so
 * "Customer GSTIN" is the GSTIN and "Item Code Qty" the quantity.
 */
const PRIORITY: Field[] = ["gstin", "aadhaar", "phone", "taxId", "state", "city", "qty", "low", "unit", "colour", "size", "aliases", "name", "item"];

const fieldsOf = (kind: ImportKind): readonly Field[] => (kind === "clients" ? CLIENT_FIELDS : ITEM_FIELDS);

/** Assign each field the best-fitting column; a column serves one field. */
export function mapHeadings(headings: string[], kind: ImportKind): Mapping {
  const pairs: { field: Field; col: number; score: number }[] = [];
  for (const field of fieldsOf(kind)) headings.forEach((h, col) => fit(h, field) && pairs.push({ field, col, score: fit(h, field) }));
  // Exact matches first; then the more specific field; then the leftmost column.
  pairs.sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.field) - PRIORITY.indexOf(b.field) || a.col - b.col);
  const map: Mapping = {};
  const used = new Set<number>();
  for (const p of pairs) {
    if (map[p.field] !== undefined || used.has(p.col)) continue;
    map[p.field] = p.col;
    used.add(p.col);
  }
  // An item list headed just "Name": that column is the item.
  if (kind === "items" && map.item === undefined) {
    const col = headings.findIndex((h, i) => !used.has(i) && fit(h, "name") > 0);
    if (col >= 0) map.item = col;
  }
  return map;
}

/** Which kind a row of headings suggests, and how sure (number of recognised headings). */
export function guessKind(headings: string[]): { kind: ImportKind; score: number } {
  const score = (kind: ImportKind) => {
    const m = mapHeadings(headings, kind);
    // Fields only one kind has decide it; name/aliases appear in both.
    const strong = kind === "clients" ? ["phone", "gstin", "aadhaar", "city", "state"] : ["item", "qty", "unit", "colour", "size", "low"];
    return Object.keys(m).length + Object.keys(m).filter((k) => strong.includes(k)).length;
  };
  const c = score("clients");
  const i = score("items");
  return i > c ? { kind: "items", score: i } : { kind: "clients", score: c };
}

const SCAN_ROWS = 20;

/**
 * The heading row: the row in the first 20 with the most recognised
 * headings. -1 when none is recognised (the sheet has no headings).
 */
export function findHeaderRow(rows: string[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, SCAN_ROWS); r++) {
    const s = guessKind(rows[r] ?? []).score;
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

/** Totals and sub-totals at the bottom of exported reports are not rows to import. */
export function isTotalRow(cells: string[]): boolean {
  const first = cells.find((c) => c.trim())?.trim() ?? "";
  // (\b doesn't work after Hindi letters, so the word end is spelled out.)
  return /^(grand\s*|sub\s*)?total\b|^(कुल|योग|ਕੁੱਲ)(?=$|[\s:.-])/i.test(first);
}

export interface SheetLayout {
  headerRow: number;
  kind: ImportKind;
  mapping: Mapping;
}

/** Best guess for a sheet; the person can change all of it before importing. */
export function readLayout(rows: string[][], kind?: ImportKind): SheetLayout {
  const headerRow = findHeaderRow(rows);
  const headings = headerRow >= 0 ? rows[headerRow] : [];
  const k = kind ?? (headerRow >= 0 ? guessKind(headings).kind : "clients");
  const mapping = headerRow >= 0 ? mapHeadings(headings, k) : {};
  // No headings: assume the first column with text is the name.
  if (headerRow < 0) {
    const width = Math.max(0, ...rows.slice(0, SCAN_ROWS).map((r) => r.length));
    for (let c = 0; c < width; c++) {
      if (rows.slice(0, SCAN_ROWS).some((r) => /\p{L}/u.test(r[c] ?? ""))) {
        mapping[k === "clients" ? "name" : "item"] = c;
        break;
      }
    }
  }
  return { headerRow, kind: k, mapping };
}

export type Row = { rowNo: number } & Partial<Record<Field, string>>;

/** Data rows as field → text, with their sheet row number (1-based, as Excel shows it). Blank and total rows dropped. */
export function toRecords(rows: string[][], layout: SheetLayout): Row[] {
  const out: Row[] = [];
  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    if (!cells.some((c) => c && c.trim()) || isTotalRow(cells)) continue;
    const rec: Row = { rowNo: r + 1 };
    let any = false;
    for (const [field, col] of Object.entries(layout.mapping) as [Field, number][]) {
      const v = (cells[col] ?? "").trim();
      if (v) {
        rec[field] = v;
        any = true;
      }
    }
    if (any) out.push(rec);
  }
  return out;
}

/** A cell as text. Numbers keep their digits (no 9.81E+09), with float noise trimmed. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (Number.isInteger(v)) return Math.abs(v) < 1e21 ? BigInt(v).toString() : String(v);
    return String(Number(v.toFixed(6)));
  }
  if (typeof v === "boolean") return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v)
    .replace(/[​-‍﻿]/g, "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
