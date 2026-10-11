/** Normalised form used for alias uniqueness and matching: lower case, no punctuation, single spaces. Keeps combining marks (\p{M}) so Indic vowel signs survive: पीस ≠ पस. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}
