/**
 * Cleaning one cell: quantities ("1,20,000", "12 pcs", "१२", "(5)"),
 * phone numbers, states ("UP", "U.P.", "उत्तर प्रदेश", GST code "09") and tax
 * IDs. Pure; every function says why a value could not be used instead of
 * throwing, so one bad cell never stops a whole import.
 */
import { normalizePhone } from "@/lib/phone";
import { cleanAadhaar, cleanGstin, isValidAadhaar, isValidGstin, OUTSIDE_INDIA, STATES } from "@/lib/india";
import { canonicalUnit } from "@/lib/units";
import { jaroWinkler } from "@/extraction/matcher";
import { squash } from "./columns";

const DIGITS: Record<string, string> = {};
// Devanagari ०-९, Gurmukhi ੦-੯, Gujarati ૦-૯, Arabic-Indic and full-width digits.
for (const base of [0x0966, 0x0a66, 0x0ae6, 0x0660, 0x06f0, 0xff10]) for (let i = 0; i < 10; i++) DIGITS[String.fromCharCode(base + i)] = String(i);
export const asciiDigits = (s: string) => s.replace(/[०-९੦-੯૦-૯٠-٩۰-۹０-９]/g, (d) => DIGITS[d] ?? d);

export type QtyResult =
  | { ok: true; centi: number; unit?: string }
  | { ok: true; empty: true }
  | { ok: false; reason: "NOT_A_NUMBER" | "TOO_MANY_DECIMALS" | "TOO_LARGE" };

const MAX_CENTI = 9_999_999_999;

/**
 * "1,20,000" → 120000; "12.5 mtr" → 12.5 + unit meter; "(5)" or "-5" → −5;
 * "", "-", "nil" → empty. Up to 2 decimal places, like every quantity here.
 */
export function parseQty(raw: string | undefined): QtyResult {
  let s = asciiDigits((raw ?? "").trim()).replace(/−/g, "-");
  if (!s || /^(-+|—|–|nil|none|na|n\/a|x)$/i.test(s)) return { ok: true, empty: true };
  let neg = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    neg = true;
    s = paren[1].trim();
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) s = s.slice(1).trim();
  const m = /^(\d[\d,\s]*(?:\.\d+)?|\.\d+)\s*([\p{L}\p{M}.]*)\s*$/u.exec(s);
  if (!m) return { ok: false, reason: "NOT_A_NUMBER" };
  const num = m[1].replace(/[,\s]/g, "");
  const unitText = m[2].replace(/\.$/, "");
  const [whole, frac = ""] = num.split(".");
  // "12.50" is fine; "12.505" would be rounded silently, so it is refused instead.
  const trimmedFrac = frac.replace(/0+$/, "");
  if (trimmedFrac.length > 2) return { ok: false, reason: "TOO_MANY_DECIMALS" };
  const centi = Number(whole || "0") * 100 + Number(trimmedFrac.padEnd(2, "0"));
  if (!Number.isSafeInteger(centi) || centi > MAX_CENTI) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, centi: neg ? -centi : centi, ...(unitText ? { unit: canonicalUnit(unitText) } : {}) };
}

export type PhoneResult = { phone: string; more: boolean } | { phone: null; bad: boolean };

/** First valid number in the cell ("98123 45678 / 97..."); `more` when the cell had others. */
export function parsePhone(raw: string | undefined): PhoneResult {
  const s = asciiDigits((raw ?? "").trim());
  if (!s) return { phone: null, bad: false };
  const parts = s.split(/[,;/|\n]+|\s{2,}|\s+(?:or|and|&)\s+/i).map((p) => p.trim()).filter(Boolean);
  const found = parts.map((p) => normalizePhone(p)).filter((p): p is string => !!p);
  if (found.length) return { phone: found[0], more: new Set(found).size > 1 };
  // "98123 45678 97123 45678": two numbers with single spaces.
  const digits = s.replace(/\D/g, "");
  if (digits.length === 20) {
    const a = normalizePhone(digits.slice(0, 10));
    if (a) return { phone: a, more: true };
  }
  return { phone: null, bad: true };
}

/** Common short forms and spellings of states. */
const STATE_SHORT: Record<string, string> = {
  up: "Uttar Pradesh", mp: "Madhya Pradesh", hp: "Himachal Pradesh", ap: "Andhra Pradesh", arp: "Arunachal Pradesh",
  pb: "Punjab", hr: "Haryana", dl: "Delhi", ncr: "Delhi", delhincr: "Delhi", newdelhi: "Delhi", nctofdelhi: "Delhi", rj: "Rajasthan", gj: "Gujarat", mh: "Maharashtra",
  ka: "Karnataka", tn: "Tamil Nadu", kl: "Kerala", ts: "Telangana", tg: "Telangana", wb: "West Bengal", or: "Odisha", od: "Odisha", orissa: "Odisha",
  br: "Bihar", jh: "Jharkhand", cg: "Chhattisgarh", ct: "Chhattisgarh", uk: "Uttarakhand", ut: "Uttarakhand", uttaranchal: "Uttarakhand",
  jk: "Jammu and Kashmir", jammukashmir: "Jammu and Kashmir", jandk: "Jammu and Kashmir", ga: "Goa", as: "Assam", ch: "Chandigarh", py: "Puducherry", pondicherry: "Puducherry",
  sk: "Sikkim", tr: "Tripura", ml: "Meghalaya", mn: "Manipur", mz: "Mizoram", nl: "Nagaland", la: "Ladakh", ld: "Lakshadweep", an: "Andaman and Nicobar Islands",
  dnh: "Dadra and Nagar Haveli and Daman and Diu", dd: "Dadra and Nagar Haveli and Daman and Diu", damananddiu: "Dadra and Nagar Haveli and Daman and Diu",
  "उत्तरप्रदेश": "Uttar Pradesh", "मध्यप्रदेश": "Madhya Pradesh", "हिमाचलप्रदेश": "Himachal Pradesh", "पंजाब": "Punjab", "हरियाणा": "Haryana", "दिल्ली": "Delhi",
  "राजस्थान": "Rajasthan", "गुजरात": "Gujarat", "महाराष्ट्र": "Maharashtra", "बिहार": "Bihar", "झारखंड": "Jharkhand", "उत्तराखंड": "Uttarakhand",
  "छत्तीसगढ़": "Chhattisgarh", "पश्चिमबंगाल": "West Bengal", "चंडीगढ़": "Chandigarh", "जम्मूकश्मीर": "Jammu and Kashmir", "ਪੰਜਾਬ": "Punjab", "ਹਰਿਆਣਾ": "Haryana", "ਦਿੱਲੀ": "Delhi", "ਚੰਡੀਗੜ੍ਹ": "Chandigarh",
  outsideindia: OUTSIDE_INDIA, abroad: OUTSIDE_INDIA, foreign: OUTSIDE_INDIA,
};

/** A state as written → the name we store, or null if unclear. Also takes GST state codes ("09", "9"). */
export function parseState(raw: string | undefined): string | null {
  const s = asciiDigits((raw ?? "").trim());
  if (!s) return null;
  const code = /^(\d{1,2})(?:\D.*)?$/.exec(s);
  if (code) {
    const byCode = STATES.find((st) => st.code === code[1].padStart(2, "0"));
    if (byCode) return byCode.name;
  }
  // "Punjab (03)", "03-Punjab": drop the code part.
  const q = squash(s.replace(/\(?\b\d{1,2}\b\)?/g, " ").replace(/&/g, "and"));
  if (!q) return null;
  if (STATE_SHORT[q]) return STATE_SHORT[q];
  const exact = STATES.find((st) => squash(st.name) === q);
  if (exact) return exact.name;
  if (squash(OUTSIDE_INDIA) === q) return OUTSIDE_INDIA;
  // Spelling slips ("Utter Pradesh", "Maharastra"): only a clear winner.
  const scored = STATES.map((st) => ({ name: st.name, score: jaroWinkler(q, squash(st.name)) })).sort((a, b) => b.score - a.score);
  if (q.length >= 4 && scored[0].score >= 0.92 && scored[0].score - scored[1].score >= 0.03) return scored[0].name;
  return null;
}

export type TaxIdResult =
  | { type: "gstin" | "aadhaar"; value: string }
  | { type: null; problem: "INVALID_GSTIN" | "INVALID_AADHAAR" | "MASKED" | "UNKNOWN_TAX_ID"; last4?: string }
  | null;

/** A GSTIN or Aadhaar from a cell; `hint` is the column it came from. Masked Aadhaar ("XXXX XXXX 1234") can't be saved. */
export function parseTaxId(raw: string | undefined, hint: "gstin" | "aadhaar" | "any"): TaxIdResult {
  const s = asciiDigits((raw ?? "").trim());
  if (!s || /^(-+|na|n\/a|nil|none|unregistered|urp|not registered)$/i.test(s)) return null;
  if (/[x*•]{4}/i.test(s)) return { type: null, problem: "MASKED", last4: s.replace(/\D/g, "").slice(-4) || undefined };
  const g = cleanGstin(s);
  if (/^\d{2}[A-Z0-9]{13}$/.test(g) && hint !== "aadhaar") return isValidGstin(g) ? { type: "gstin", value: g } : { type: null, problem: "INVALID_GSTIN" };
  const a = cleanAadhaar(s);
  if (/^\d{12}$/.test(a) && hint !== "gstin") return isValidAadhaar(a) ? { type: "aadhaar", value: a } : { type: null, problem: "INVALID_AADHAAR" };
  if (hint === "gstin") return { type: null, problem: "INVALID_GSTIN" };
  if (hint === "aadhaar") return { type: null, problem: "INVALID_AADHAAR" };
  return { type: null, problem: "UNKNOWN_TAX_ID" };
}

/** "Sharma, Sharma ji; शर्मा" → separate names. */
export function splitAliases(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,;|/\n]+/).map((a) => a.trim().replace(/\s+/g, " ")).filter((a) => a.length >= 2 && a.length <= 80))];
}

/** Names: single spaces, no stray quotes, at most 120 characters. */
export function cleanName(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
