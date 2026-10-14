/**
 * Learning extra names: when someone picks a suggested client or item for
 * what was written or said ("Sharmaa" → Sharma Textiles), that spelling is
 * saved as an extra name so it matches by itself next time.
 *
 * Not learned (so a learned name can never cause a wrong automatic pick):
 * - it already matches something exactly;
 * - it is too short or has no letters;
 * - it could also mean another client/item (e.g. "Sharma" when there are
 *   Sharma Textiles and Sharma Traders).
 */
import type { Db } from "@/db/types";
import { auditLog, itemAliases, partyAliases } from "@/db/schema";
import { loadCatalog } from "@/extraction/catalog";
import { matchMention, type CatalogEntry } from "@/extraction/matcher";
import { normalizeName } from "@/lib/normalize";
import { displayScript } from "@/lib/script";
import { stockOf, type Ctx } from "@/ledger/service";

export interface Pick {
  kind: "party" | "item";
  id: string;
  /** What was written or said. */
  mention: string;
}

/** Another entry this close to the mention makes it ambiguous. */
const AMBIGUOUS = 0.84;
const MAX_PICKS = 30;

export async function learnAliases(db: Db, ctx: Ctx, picks: Pick[]): Promise<Pick[]> {
  if (ctx.role === "viewer" || !picks.length) return [];
  const catalog = await loadCatalog(db, ctx.companyId, stockOf(ctx));
  const learned: Pick[] = [];
  const seen = new Set<string>();
  for (const p of picks.slice(0, MAX_PICKS)) {
    const alias = displayScript(p.mention ?? "").trim().replace(/\s+/g, " ");
    const normalized = normalizeName(alias);
    if (normalized.replace(/\s/g, "").length < 2 || !/\p{L}/u.test(normalized) || alias.length > 80) continue;
    const key = `${p.kind}|${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list: CatalogEntry[] = p.kind === "party" ? catalog.parties : catalog.items;
    if (!list.some((e) => e.id === p.id)) continue;
    const r = matchMention({ asWritten: alias }, list);
    // Already matches by itself (exactly): nothing to learn.
    if (r.status === "matched" || r.candidates.some((c) => c.score === 1)) continue;
    if (r.status === "missing") continue;
    // Could also mean something else: don't teach it one meaning.
    if (r.candidates.some((c) => c.id !== p.id && c.score >= AMBIGUOUS)) continue;
    const row = { companyId: ctx.companyId, alias, normalized, createdBy: ctx.userId };
    const inserted =
      p.kind === "party"
        ? await db.insert(partyAliases).values({ ...row, partyId: p.id }).onConflictDoNothing().returning({ id: partyAliases.id })
        : await db.insert(itemAliases).values({ ...row, companyId: stockOf(ctx), itemId: p.id }).onConflictDoNothing().returning({ id: itemAliases.id });
    if (!inserted.length) continue;
    await db.insert(auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action: `${p.kind}.alias.learn`, entityType: p.kind, entityId: p.id, details: { alias } });
    learned.push({ ...p, mention: alias });
  }
  return learned;
}

/** The picks an entry carries: each picked client/item with what was written or said for it. */
export function picksFrom(b: { learn?: unknown }): Pick[] {
  if (!Array.isArray(b.learn)) return [];
  return b.learn
    .filter((x): x is Pick => !!x && (x.kind === "party" || x.kind === "item") && typeof x.id === "string" && typeof x.mention === "string" && !!x.mention.trim())
    .map((x) => ({ kind: x.kind, id: x.id, mention: x.mention }));
}
