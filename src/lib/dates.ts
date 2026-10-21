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

/** A day picked from History: a real date before today, else undefined (= today). */
export function pastDay(s: string | undefined, now: Date = new Date()): string | undefined {
  return s && isValidDate(s) && s < todayIST(now) ? s : undefined;
}

// Display formats, spelled out here rather than by the browser: Safari and the
// server's Node write "en-IN" dates differently ("Tue, 20 Oct, 2026" vs
// "Tue, 20 Oct 2026", "am" vs "AM"), and a screen drawn on the server must read
// exactly the same once the phone takes over.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IST_OFFSET_MS = 330 * 60_000; // India has no daylight saving

/** "20 Oct", "20 Oct 2026", "Tue, 20 Oct 2026" for a YYYY-MM-DD date. */
export function formatDay(s: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const d = new Date(`${s}T00:00:00Z`);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${opts.year ? ` ${d.getUTCFullYear()}` : ""}`;
  return opts.weekday ? `${WEEKDAYS[d.getUTCDay()]}, ${day}` : day;
}

/** "9:33 am" in India. */
export function formatTimeIST(at: Date | number | string): string {
  const d = new Date(new Date(at).getTime() + IST_OFFSET_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "20 Oct, 9:33 am" in India. */
export function formatDateTimeIST(at: Date | number | string): string {
  const d = new Date(new Date(at).getTime() + IST_OFFSET_MS);
  return `${formatDay(d.toISOString().slice(0, 10))}, ${formatTimeIST(at)}`;
}
