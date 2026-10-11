/**
 * Gurmukhi (Punjabi script) → Devanagari (Hindi script).
 *
 * For now the app shows Punjabi in Hindi letters. The two Unicode blocks
 * are laid out in parallel (U+0A00 ↔ U+0900), so most letters map by a fixed
 * offset; the few Gurmukhi-only signs are handled explicitly. Digits become
 * ASCII so quantities read the same everywhere.
 */
const GURMUKHI = /[਀-੿]/;
const VIRAMA = "्";

const BEARER_VOWELS: Record<string, Record<string, string>> = {
  // ੳ (ura) + vowel sign → independent vowel
  "ੳ": { "ੁ": "उ", "ੂ": "ऊ", "ੋ": "ओ", "": "उ" },
  // ੲ (iri) + vowel sign → independent vowel
  "ੲ": { "ਿ": "इ", "ੀ": "ई", "ੇ": "ए", "": "इ" },
};

const isConsonant = (c: string) => c >= "ਕ" && c <= "ਹ";

export function gurmukhiToDevanagari(input: string): string {
  if (!GURMUKHI.test(input)) return input;
  const chars = [...input];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const code = c.codePointAt(0)!;
    if (code < 0x0a00 || code > 0x0a7f) {
      out += c;
      continue;
    }
    if (BEARER_VOWELS[c]) {
      const next = chars[i + 1] ?? "";
      const v = BEARER_VOWELS[c][next];
      if (v && next) {
        out += v;
        i++;
      } else out += BEARER_VOWELS[c][""];
      continue;
    }
    // ਸ + nukta is "sh" (श), ਲ + nukta is ळ; other nukta letters map by offset.
    if ((c === "ਸ" || c === "ਲ") && chars[i + 1] === "਼") {
      out += c === "ਸ" ? "श" : "ळ";
      i++;
      continue;
    }
    if (c === "ੰ") {
      out += "ं"; // tippi → anusvara
      continue;
    }
    if (c === "ੱ") {
      // addak doubles the next consonant: ਪੱਕਾ → पक्का
      const next = chars[i + 1];
      if (next && isConsonant(next)) out += String.fromCodePoint(next.codePointAt(0)! - 0x100) + VIRAMA;
      continue;
    }
    if (c === "ੴ") {
      out += "ॐ";
      continue;
    }
    if (c === "ੵ") {
      out += VIRAMA + "य"; // yakash
      continue;
    }
    if (code >= 0x0a66 && code <= 0x0a6f) {
      out += String(code - 0x0a66); // Gurmukhi digits → 0-9
      continue;
    }
    out += String.fromCodePoint(code - 0x100);
  }
  return out;
}

/** Text as the app shows it: Hindi script for Punjabi, everything else unchanged. */
export const displayScript = gurmukhiToDevanagari;
