/**
 * Building sentences from words and numbers without losing spaces:
 * `fill("Only {n} in stock", { n: "5 pcs" })` and `words("sending", "6", "pcs")`.
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Joins the non-empty parts with single spaces. */
export function words(...parts: (string | number | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string | number => p !== null && p !== undefined && p !== false && String(p).trim() !== "")
    .map((p) => String(p).trim())
    .join(" ");
}
