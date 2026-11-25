/**
 * Bill arithmetic. Money is whole paise and quantities whole hundredths
 * (centi, as in lib/qty.ts), so nothing drifts with floating point.
 *
 * GST bill: tax per GST rate on the taxable value (after discount). Within
 * the firm's state it is split into CGST + SGST; to another state it is
 * IGST. Freight/packing on a GST bill is taxed at the highest line rate.
 * Kacha bill: no tax at all. Both are rounded to the nearest rupee.
 */

export type BillKind = "gst" | "kacha";

export interface BillLineInput {
  /** Hundredths: 2050 = 20.5 */
  quantity: number;
  /** Paise per unit. */
  rate: number;
  /** Hundredths of a percent: 500 = 5%. */
  discountPct?: number;
  /** Hundredths of a percent: 500 = 5%. Ignored on kacha bills. */
  gstRate?: number;
}

export interface TaxRow {
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface BillTotals {
  lines: { gross: number; discount: number; taxable: number }[];
  /** Before discount. */
  gross: number;
  discount: number;
  charges: number;
  taxable: number;
  taxes: TaxRow[];
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
}

/** Half away from zero, the way people round money. */
const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

export function computeBill(kind: BillKind, lines: BillLineInput[], opts: { interstate: boolean; charges?: number }): BillTotals {
  const rows = lines.map((l) => {
    const gross = round((l.quantity * l.rate) / 100);
    const discount = round((gross * (l.discountPct ?? 0)) / 10_000);
    return { gross, discount, taxable: gross - discount, gstRate: kind === "gst" ? (l.gstRate ?? 0) : 0 };
  });
  const charges = opts.charges ?? 0;
  const byRate = new Map<number, number>();
  for (const r of rows) byRate.set(r.gstRate, (byRate.get(r.gstRate) ?? 0) + r.taxable);
  if (charges) {
    const top = Math.max(0, ...rows.map((r) => r.gstRate));
    byRate.set(top, (byRate.get(top) ?? 0) + charges);
  }
  const taxes: TaxRow[] =
    kind === "gst"
      ? [...byRate.entries()]
          .sort(([a], [b]) => a - b)
          .map(([gstRate, taxable]) => {
            if (opts.interstate) return { gstRate, taxable, cgst: 0, sgst: 0, igst: round((taxable * gstRate) / 10_000) };
            const half = round((taxable * gstRate) / 20_000);
            return { gstRate, taxable, cgst: half, sgst: half, igst: 0 };
          })
      : [];
  const sum = (f: (x: TaxRow) => number) => taxes.reduce((s, x) => s + f(x), 0);
  const taxable = rows.reduce((s, r) => s + r.taxable, 0) + charges;
  const cgst = sum((x) => x.cgst);
  const sgst = sum((x) => x.sgst);
  const igst = sum((x) => x.igst);
  const exact = taxable + cgst + sgst + igst;
  const total = round(exact / 100) * 100;
  return {
    lines: rows.map(({ gross, discount, taxable }) => ({ gross, discount, taxable })),
    gross: rows.reduce((s, r) => s + r.gross, 0),
    discount: rows.reduce((s, r) => s + r.discount, 0),
    charges,
    taxable,
    taxes,
    cgst,
    sgst,
    igst,
    roundOff: total - exact,
    total,
  };
}

/** Financial year of a date (1 April to 31 March): "2026-11-15" → "26-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** A firm with no prefix set gets its initials: "Shree Ganesh Textiles" → "SGT". */
export function defaultPrefix(firmName: string): string {
  const initials = firmName
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
  return initials || "BILL";
}

/** GST bills: SGT/26-27/0007. Kacha bills have their own series: SGT/K/26-27/0003. */
export function billNumber(prefix: string, kind: BillKind, fy: string, seq: number): string {
  return `${prefix}${kind === "kacha" ? "/K" : ""}/${fy}/${String(seq).padStart(4, "0")}`;
}

/** "₹1,23,456.50" (Indian grouping). */
export function formatRupees(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const s = String(rupees);
  const grouped = s.length > 3 ? `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}` : s;
  return `${neg ? "−" : ""}₹${grouped}.${String(p).padStart(2, "0")}`;
}

/** Paise as typed text: 45050 → "450.50", 45000 → "450". */
export const paiseToText = (paise: number) => (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100));

/** "450", "450.5", "1,200.75" → paise; null if it isn't an amount. */
export function parseRupees(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [r, p = ""] = t.split(".");
  return Number(r) * 100 + Number(p.padEnd(2, "0"));
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole rupees in words, Indian system: 1,23,456 → "One Lakh Twenty Three Thousand Four Hundred Fifty Six". */
function rupeesInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${rupeesInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** For the bottom of a bill: "Rupees Twelve Thousand Four Hundred Fifty Only". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `Rupees ${rupeesInWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
}

export interface HsnRow {
  /** null: lines without an HSN code. */
  hsn: string | null;
  /** The freight/packing row (taxed at the highest line rate). */
  charges?: true;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * The HSN-wise tax table printed under a GST bill: one row per HSN code and
 * rate. Each row's tax is worked out on its own, then the biggest row of each
 * rate takes up any paisa of rounding, so the rows always add up to the bill.
 */
export function hsnSummary(lines: { hsn: string | null; gstRate: number }[], totals: BillTotals, interstate: boolean): HsnRow[] {
  if (!totals.taxes.length) return [];
  const rows = new Map<string, HsnRow>();
  const add = (key: string, row: Omit<HsnRow, "taxable" | "cgst" | "sgst" | "igst">, taxable: number) => {
    const r = rows.get(key) ?? { ...row, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += taxable;
    rows.set(key, r);
  };
  lines.forEach((l, i) => add(`${l.hsn ?? ""}|${l.gstRate}`, { hsn: l.hsn, gstRate: l.gstRate }, totals.lines[i]?.taxable ?? 0));
  if (totals.charges) {
    const top = Math.max(0, ...lines.map((l) => l.gstRate));
    add(`charges|${top}`, { hsn: null, charges: true, gstRate: top }, totals.charges);
  }
  const out = [...rows.values()];
  for (const r of out) {
    if (interstate) r.igst = round((r.taxable * r.gstRate) / 10_000);
    else r.cgst = r.sgst = round((r.taxable * r.gstRate) / 20_000);
  }
  for (const t of totals.taxes) {
    const group = out.filter((r) => r.gstRate === t.gstRate);
    if (!group.length) continue;
    const big = group.reduce((a, b) => (b.taxable > a.taxable ? b : a));
    big.cgst += t.cgst - group.reduce((s, r) => s + r.cgst, 0);
    big.sgst += t.sgst - group.reduce((s, r) => s + r.sgst, 0);
    big.igst += t.igst - group.reduce((s, r) => s + r.igst, 0);
  }
  return out;
}

/** "1,23,456.50": an amount in a bill's columns, without the ₹. */
export const formatAmount = (paise: number) => formatRupees(paise).replace("₹", "");
