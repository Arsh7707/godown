/**
 * Indian states / UTs (with their GST state codes), and GSTIN / Aadhaar checks.
 */

/** GST state code → name. Names are what we store and show. */
export const STATES: { code: string; name: string }[] = [
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" },
  { code: "10", name: "Bihar" },
  { code: "04", name: "Chandigarh" },
  { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "07", name: "Delhi" },
  { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" },
  { code: "06", name: "Haryana" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" },
  { code: "20", name: "Jharkhand" },
  { code: "29", name: "Karnataka" },
  { code: "32", name: "Kerala" },
  { code: "38", name: "Ladakh" },
  { code: "31", name: "Lakshadweep" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" },
  { code: "14", name: "Manipur" },
  { code: "17", name: "Meghalaya" },
  { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" },
  { code: "21", name: "Odisha" },
  { code: "34", name: "Puducherry" },
  { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" },
  { code: "11", name: "Sikkim" },
  { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
  { code: "16", name: "Tripura" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "05", name: "Uttarakhand" },
  { code: "19", name: "West Bengal" },
];
/** For people based outside India (e.g. an owner abroad). */
export const OUTSIDE_INDIA = "Outside India";
export const STATE_NAMES = [...STATES.map((s) => s.name), OUTSIDE_INDIA];

export function isState(s: string): boolean {
  return STATE_NAMES.includes(s);
}

export function stateForGstin(gstin: string): string | null {
  return STATES.find((s) => s.code === gstin.slice(0, 2))?.name ?? null;
}

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Spaces/dashes removed, upper case. */
export const cleanGstin = (s: string) => s.replace(/[\s-]+/g, "").toUpperCase();

/**
 * 15 characters: 2-digit state code, PAN (5 letters, 4 digits, 1 letter),
 * entity number, "Z", and a check character (mod-36 checksum).
 */
export function isValidGstin(raw: string): boolean {
  const g = cleanGstin(raw);
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  if (!stateForGstin(g) && !["97", "99"].includes(g.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

// Verhoeff tables (Aadhaar's last digit is a Verhoeff check digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export const cleanAadhaar = (s: string) => s.replace(/[\s-]+/g, "");

/** 12 digits, not starting with 0 or 1, valid Verhoeff check digit. */
export function isValidAadhaar(raw: string): boolean {
  const a = cleanAadhaar(raw);
  if (!/^[2-9]\d{11}$/.test(a)) return false;
  let c = 0;
  [...a].reverse().forEach((ch, i) => (c = D[c][P[i % 8][Number(ch)]]));
  return c === 0;
}

/** XXXX XXXX 1234 */
export const maskAadhaar = (a: string) => `XXXX XXXX ${cleanAadhaar(a).slice(-4)}`;
export const formatAadhaar = (a: string) => cleanAadhaar(a).replace(/(\d{4})(?=\d)/g, "$1 ");

export type TaxIdType = "gstin" | "aadhaar";

/** What anyone may see: GSTIN in full, Aadhaar masked. */
export function displayTaxId(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  return type === "aadhaar" ? maskAadhaar(id) : id;
}
