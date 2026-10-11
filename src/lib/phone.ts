/**
 * Phone numbers are identities, stored in E.164 ("+919812345678").
 * A bare 10-digit number starting 6-9 is taken as Indian.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(`+${digits}`) ? `+${digits}` : null;
  if (/^0?[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(-10)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

/** "+91 92156 22330" for display. */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (us) return `+1 ${us[1]}-${us[2]}-${us[3]}`;
  return e164;
}
