import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { itemAliases, items, parties, partyAliases } from "@/db/schema";
import type { Catalog } from "./types";

/** Active parties and items with their aliases, for one company. */
export async function loadCatalog(db: Db, companyId: string): Promise<Catalog> {
  const [ps, pa, its, ia] = await Promise.all([
    db.select().from(parties).where(and(eq(parties.companyId, companyId), eq(parties.active, true))),
    db.select().from(partyAliases).where(eq(partyAliases.companyId, companyId)),
    db.select().from(items).where(and(eq(items.companyId, companyId), eq(items.active, true))),
    db.select().from(itemAliases).where(eq(itemAliases.companyId, companyId)),
  ]);
  const aliasesOf = (rows: { alias: string; ownerId: string }[], id: string) => rows.filter((r) => r.ownerId === id).map((r) => r.alias);
  const pAliases = pa.map((a) => ({ alias: a.alias, ownerId: a.partyId }));
  const iAliases = ia.map((a) => ({ alias: a.alias, ownerId: a.itemId }));
  return {
    parties: ps.map((p) => ({ id: p.id, name: p.name, aliases: aliasesOf(pAliases, p.id) })).sort((a, b) => a.name.localeCompare(b.name)),
    items: its.map((i) => ({ id: i.id, name: i.name, unit: i.unit, aliases: aliasesOf(iAliases, i.id) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
