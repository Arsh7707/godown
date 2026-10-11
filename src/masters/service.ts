/**
 * Master data: parties, items, aliases. Every write is audited.
 * Master rows are reference data, not ledger rows: they can be updated in
 * place (Phase 4), with the before/after kept in the audit log.
 */
import type { Db } from "@/db/types";
import { auditLog, itemAliases, items, parties, partyAliases } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { normalizeName } from "@/lib/normalize";
import { centiToDecimal, toCenti } from "@/lib/qty";
import { and, eq } from "drizzle-orm";
import type { Ctx } from "@/ledger/service";

/** Owners and staff can add a new party or item while making an entry; changing existing ones is owner-only (Phase 4). */
function requireCreator(ctx: Ctx) {
  if (ctx.role !== "owner" && ctx.role !== "staff") throw new LedgerError("FORBIDDEN", "Viewers cannot add parties or items");
}

export async function createParty(db: Db, ctx: Ctx, input: { name: string; phone?: string | null; aliases?: string[] }) {
  requireCreator(ctx);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(parties)
      .values({ companyId: ctx.companyId, name: input.name.trim(), phone: input.phone ?? null, createdBy: ctx.userId })
      .returning();
    for (const alias of input.aliases ?? []) {
      await tx.insert(partyAliases).values({
        companyId: ctx.companyId,
        partyId: p.id,
        alias,
        normalized: normalizeName(alias),
        createdBy: ctx.userId,
      });
    }
    await tx.insert(auditLog).values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "party.create",
      entityType: "party",
      entityId: p.id,
      details: input,
    });
    return p;
  });
}

export async function createItem(
  db: Db,
  ctx: Ctx,
  input: { name: string; unit: string; aliases?: string[]; product?: string; variant?: string | null; lowStockLevel?: string | number },
) {
  requireCreator(ctx);
  return db.transaction(async (tx) => {
    const [it] = await tx
      .insert(items)
      .values({
        companyId: ctx.companyId,
        name: input.name.trim(),
        unit: input.unit.trim(),
        product: (input.product ?? input.name).trim(),
        variant: input.variant?.trim() || null,
        lowStockLevel: centiToDecimal(input.lowStockLevel === undefined ? 1000 : toCenti(String(input.lowStockLevel))),
        createdBy: ctx.userId,
      })
      .returning();
    for (const alias of input.aliases ?? []) {
      await tx.insert(itemAliases).values({
        companyId: ctx.companyId,
        itemId: it.id,
        alias,
        normalized: normalizeName(alias),
        createdBy: ctx.userId,
      });
    }
    await tx.insert(auditLog).values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "item.create",
      entityType: "item",
      entityId: it.id,
      details: input,
    });
    return it;
  });
}

/** Display name for a variant: "Vistara · Red". */
export const variantName = (product: string, variant: string) => `${product.trim()} · ${variant.trim()}`;

/**
 * A product, with one item per colour/size if given. Owner only (staff can
 * still add a single item while making an entry).
 */
export async function createProduct(
  db: Db,
  ctx: Ctx,
  input: { name: string; unit: string; variants?: string[]; lowStockLevel?: string | number; aliases?: string[] },
) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can add products");
  const variants = [...new Set((input.variants ?? []).map((v) => v.trim()).filter(Boolean))];
  if (!variants.length) return [await createItem(db, ctx, { name: input.name, unit: input.unit, product: input.name, lowStockLevel: input.lowStockLevel, aliases: input.aliases })];
  const out = [];
  for (const v of variants) {
    out.push(await createItem(db, ctx, { name: variantName(input.name, v), unit: input.unit, product: input.name, variant: v, lowStockLevel: input.lowStockLevel }));
  }
  return out;
}

/** Change an item's alert level or add aliases. Owner only; before/after kept in the audit log. */
export async function updateItemSettings(db: Db, ctx: Ctx, itemId: string, input: { lowStockLevel?: string | number; addAliases?: string[] }) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can change items");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.companyId, ctx.companyId)));
    if (!before) throw new LedgerError("NOT_FOUND", "Item not found");
    if (input.lowStockLevel !== undefined) {
      await tx
        .update(items)
        .set({ lowStockLevel: centiToDecimal(toCenti(String(input.lowStockLevel))) })
        .where(eq(items.id, itemId));
    }
    for (const alias of input.addAliases ?? []) {
      if (!alias.trim()) continue;
      await tx
        .insert(itemAliases)
        .values({ companyId: ctx.companyId, itemId, alias: alias.trim(), normalized: normalizeName(alias), createdBy: ctx.userId })
        .onConflictDoNothing();
    }
    await tx.insert(auditLog).values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "item.update",
      entityType: "item",
      entityId: itemId,
      details: { before: { lowStockLevel: before.lowStockLevel }, after: input },
    });
  });
}
