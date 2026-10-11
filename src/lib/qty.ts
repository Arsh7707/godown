/**
 * Quantities are held as integer hundredths ("centi") in code so that
 * 12.5 m + 0.1 m never drifts. The database stores numeric(12,2).
 */
import { LedgerError } from "./errors";

const QTY_RE = /^\d+(\.\d{1,2})?$/;
const MAX_CENTI = 9_999_999_999; // numeric(12,2) ceiling

export function toCenti(value: string | number): number {
  const s = typeof value === "number" ? String(value) : value.trim();
  if (!QTY_RE.test(s)) throw new LedgerError("INVALID_QTY", `Invalid quantity: ${value}`);
  const [whole, frac = ""] = s.split(".");
  const centi = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(centi) || centi > MAX_CENTI) throw new LedgerError("INVALID_QTY", `Quantity too large: ${value}`);
  return centi;
}

/** Positive quantity for an order or dispatch line. */
export function toPositiveCenti(value: string | number): number {
  const c = toCenti(value);
  if (c <= 0) throw new LedgerError("INVALID_QTY", "Quantity must be more than 0");
  return c;
}

/** "12.50" for the database. */
export function centiToDecimal(centi: number): string {
  const sign = centi < 0 ? "-" : "";
  const abs = Math.abs(centi);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "12.5", "5" for display. */
export function formatQty(centi: number): string {
  return centiToDecimal(centi).replace(/\.?0+$/, "") || "0";
}
