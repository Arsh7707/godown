/**
 * Devanagari → Latin, and a "sounds-like" key for comparing names however
 * they are spelled: शर्मा / Sharma / Sharmaa / sarma all give the same key.
 *
 * Used only to rank suggestions. An exact name / extra-name match is still
 * the only thing that picks automatically.
 */
import { displayScript } from "./script";

const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ii", उ: "u", ऊ: "uu", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e", ऎ: "e", ऒ: "o",
};
const SIGNS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e", "ॆ": "e", "ॊ": "o",
};
const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n", ऩ: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ऱ: "r", ल: "l", ळ: "l", ऴ: "l", व: "v",
  श: "sh", ष: "sh", स: "s", ह: "h",
  क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f", य़: "y",
};
const NUKTA_BASE: Record<string, string> = { क: "क़", ख: "ख़", ग: "ग़", ज: "ज़", ड: "ड़", ढ: "ढ़", फ: "फ़", य: "य़" };
const VIRAMA = "्";
const NUKTA = "़";

/** Devanagari (and Gurmukhi, via Hindi letters) to plain Latin letters; other text passes through. */
export function toLatin(input: string): string {
  const chars = [...displayScript(input).normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i];
    if (chars[i + 1] === NUKTA && NUKTA_BASE[c]) {
      c = NUKTA_BASE[c];
      i++;
    }
    if (CONSONANTS[c] !== undefined) {
      out += CONSONANTS[c];
      const next = chars[i + 1];
      if (next === VIRAMA) {
        i++;
      } else if (next && SIGNS[next] !== undefined) {
        out += SIGNS[next];
        i++;
      } else {
        // Inherent "a", dropped at the end of a word (राम → ram, not rama).
        if (next && /[\u0900-\u097F]/.test(next)) out += "a";
      }
      continue;
    }
    if (VOWELS[c] !== undefined) out += VOWELS[c];
    else if (c === "ं" || c === "ँ") out += "n";
    else if (c === "ः") out += "h";
    else if (c === "ॐ") out += "om";
    else if (c >= "०" && c <= "९") out += String(c.charCodeAt(0) - 0x0966);
    else if (c === VIRAMA || c === NUKTA || c === "।" || c === "॥") continue;
    else out += c;
  }
  return out;
}

/**
 * Spelling-proof key for one name: Latin letters, then the usual Hinglish
 * variations folded together (sh/s, v/w, ph/f, z/j, q/k, c/k, aa/a, ee/i,
 * oo/u, y/i, doubled letters, aspirated h), and the short "a" inside
 * words dropped because people write it inconsistently (Sudarshan/Sudershan,
 * Navratri/Navaratri).
 */
export function phoneticKey(input: string): string {
  const s = toLatin(input)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ");
  const word = (w: string) => {
    if (/^\d+$/.test(w)) return w;
    let x = w
      .replace(/ow([^aeiou]|$)/g, "au$1")
      .replace(/ph/g, "f")
      .replace(/ck/g, "k")
      .replace(/q/g, "k")
      .replace(/x/g, "ks")
      .replace(/z/g, "j")
      .replace(/w/g, "v")
      .replace(/chh/g, "C")
      .replace(/ch/g, "C")
      .replace(/sh/g, "s")
      .replace(/c/g, "k")
      .replace(/C/g, "c")
      .replace(/([kgjtdpbcr])h/g, "$1")
      .replace(/([^aeiou])y([^aeiou]|$)/g, "$1i$2")
      .replace(/ee|ii|ie|ea|ey/g, "i")
      .replace(/oo|uu|ou/g, "u")
      .replace(/aa/g, "a")
      .replace(/(.)\1+/g, "$1");
    // Silent final e (life → lif) and the inherent "a" inside / at the end of the word.
    if (x.length > 3) x = x.replace(/([^aeiou])e$/, "$1");
    x = x[0] + x.slice(1).replace(/a/g, "");
    return x;
  };
  return s
    .split(" ")
    .filter(Boolean)
    .map(word)
    .join(" ");
}

/** Consonant outline (first letter kept): catches English spellings of Hindi sounds, e.g. Famous / फेमस → fms. */
export function skeletonKey(input: string): string {
  return phoneticKey(input)
    .split(" ")
    .map((w) => (/^\d+$/.test(w) ? w : w[0] + w.slice(1).replace(/[aeiou]/g, "")))
    .join(" ");
}
