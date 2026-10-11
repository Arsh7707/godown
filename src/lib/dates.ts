/**
 * All business dates are calendar dates in Asia/Kolkata, as "YYYY-MM-DD".
 */
import { LedgerError } from "./errors";

export const TZ = "Asia/Kolkata";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in India. */
export function todayIST(now: Date = new Date()): string {
  return fmt.format(now);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Order and dispatch dates: today or earlier, never in the future. */
export function assertEntryDate(s: string, now: Date = new Date()): void {
  if (!isValidDate(s)) throw new LedgerError("INVALID_DATE", `Invalid date: ${s}`);
  const today = todayIST(now);
  if (s > today) throw new LedgerError("FUTURE_DATE", `Date ${s} is in the future`, { date: s, today });
}

/** Promised delivery dates may be past or future; they only need to be real dates. */
export function assertPromisedDate(s: string): void {
  if (!isValidDate(s)) throw new LedgerError("INVALID_DATE", `Invalid date: ${s}`);
}

/** Calendar arithmetic on YYYY-MM-DD. */
export function addDays(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
