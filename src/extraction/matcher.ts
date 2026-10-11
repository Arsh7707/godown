/**
 * Deterministic matching of extracted names against the company's own
 * party and item lists (names + aliases).
 *
 * Only an exact name/alias match (after normalisation) is accepted
 * automatically. Anything else returns up to 3 candidates for the user to
 * pick from, or none (create new). The model's catalog guess only raises a
 * candidate's rank; it never auto-selects.
 */
import { normalizeName } from "@/lib/normalize";
import { displayScript } from "@/lib/script";

export interface CatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  /** Items only. */
  unit?: string;
}

export interface Mention {
  asWritten: string;
  latin?: string | null;
  catalogGuess?: string | null;
}

export interface Candidate {
  id: string;
  name: string;
  score: number;
}

export type MatchResult =
  | { status: "matched"; id: string; name: string; mention: string; candidates: Candidate[] }
  | { status: "choose"; mention: string; candidates: Candidate[] }
  | { status: "missing"; mention: null; candidates: [] };

const MIN_CANDIDATE_SCORE = 0.75;
const GUESS_BOOST = 0.1;
/** Courtesy words that are not part of the name: "M/s Sharma Textiles", "Sharma ji", "Shri Gupta". */
const HONORIFICS = new Set(["ms", "messrs", "shri", "sri", "seth", "sethji", "ji", "jee", "जी", "श्री", "सेठ", "ਜੀ", "ਸ੍ਰੀ", "ਸ਼੍ਰੀ", "ਸੇਠ", "wala", "wale", "vala", "vale", "waale", "वाला", "वाले", "ਵਾਲਾ", "ਵਾਲੇ"]);
/** Colour words as said in Hindi/Punjabi/Hinglish → the English names used for variants ("Art Line · Red"). */
const COLOURS: Record<string, string> = {
  laal: "red", lal: "red", "लाल": "red",
  neela: "blue", nila: "blue", neeli: "blue", "नीला": "blue", "नीली": "blue", "नीले": "blue",
  hara: "green", hari: "green", "हरा": "green", "हरी": "green", "हरे": "green",
  kaala: "black", kala: "black", kaali: "black", kali: "black", "काला": "black", "काली": "black", "काले": "black",
  safed: "white", safaid: "white", "सफेद": "white", "सफ़ेद": "white",
  peela: "yellow", pila: "yellow", peeli: "yellow", "पीला": "yellow", "पीली": "yellow",
  gulabi: "pink", "गुलाबी": "pink",
  narangi: "orange", naarangi: "orange", "नारंगी": "orange",
  bhoora: "brown", bhura: "brown", "भूरा": "brown",
  jamuni: "purple", baingani: "purple", "जामुनी": "purple", "बैंगनी": "purple",
  sunehra: "golden", sunehri: "golden", "सुनहरा": "golden", "सुनहरी": "golden",
  slaty: "grey", sleti: "grey", "स्लेटी": "grey", gray: "grey",
};

function stripHonorifics(s: string): string {
  // Compare across scripts: a Gurmukhi alias matches the same name in Hindi letters.
  return normalizeName(displayScript(s))
    .replace(/^m s /, "")
    .split(" ")
    .filter((w) => !HONORIFICS.has(w))
    .map((w) => COLOURS[w] ?? w)
    .join(" ");
}
const compact = (s: string) => stripHonorifics(s).replace(/\s+/g, "");
const wordSet = (s: string) => stripHonorifics(s).split(" ").filter(Boolean).sort().join(" ");
const digits = (s: string) => s.replace(/\D+/g, "");

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similarity of one mention form to one catalog key. */
function similarity(mention: string, key: string): number {
  const m = compact(mention);
  const k = compact(key);
  if (!m || !k) return 0;
  let score = jaroWinkler(m, k);
  // "sharma" inside "sharma textiles": every word of the mention appears in the key.
  const mWords = stripHonorifics(mention).split(" ").filter(Boolean);
  const kWords = new Set(stripHonorifics(key).split(" "));
  if (mWords.length && mWords.every((w) => kWords.has(w))) score = Math.max(score, 0.85);
  // Design numbers: "4012" vs "D-4012".
  const md = digits(mention);
  if (md.length >= 3 && md === digits(key)) score = Math.max(score, 0.9);
  return score;
}

function keysOf(e: CatalogEntry) {
  return [e.name, ...e.aliases];
}

export function matchMention(mention: Mention | null | undefined, catalog: readonly CatalogEntry[]): MatchResult {
  const forms = [mention?.asWritten, mention?.latin].filter((s): s is string => !!s && !!compact(s));
  if (!forms.length) return { status: "missing", mention: null, candidates: [] };
  const display = displayScript(mention!.asWritten || mention!.latin!);

  // Exact (normalised) name/alias match; word order doesn't matter ("लाल Vistara" = "Vistara · Red").
  const exact = catalog.filter((e) => keysOf(e).some((k) => forms.some((f) => compact(f) === compact(k) || wordSet(f) === wordSet(k))));

  const guess = mention?.catalogGuess ? compact(mention.catalogGuess) : null;
  const scored: Candidate[] = catalog
    .map((e) => {
      let score = Math.max(...keysOf(e).flatMap((k) => forms.map((f) => similarity(f, k))));
      if (guess && compact(e.name) === guess) score = Math.min(0.99, score + GUESS_BOOST);
      if (exact.includes(e)) score = 1;
      return { id: e.id, name: e.name, score: Math.round(score * 100) / 100 };
    })
    .filter((c) => c.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);

  if (exact.length === 1) {
    return { status: "matched", id: exact[0].id, name: exact[0].name, mention: display, candidates: scored };
  }
  return { status: "choose", mention: display, candidates: scored };
}
