/**
 * Owner screens for clients (parties) and items: rename, extra names
 * (aliases), hide, delete-if-unused, colours/sizes.
 *
 * Parties and items are reference data, updated in place with before/after in
 * the audit log. Renaming keeps the old name as an alias so slips and voice
 * notes using it still match. Anything already used in an order, dispatch or
 * stock entry can be hidden but not deleted.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { auditLog, dispatchLines, dispatchRevisions, itemAliases, items, orderLineVersions, orderRevisions, parties, partyAliases, stockMovements } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { normalizeName } from "@/lib/normalize";
import { centiToDecimal, toCenti } from "@/lib/qty";
import { stockOf, type Ctx } from "@/ledger/service";
import { stockOverview } from "@/stock/service";
import { createItem, variantName } from "./service";
import { partyProfileSet, safeTaxId, type PartyProfileInput } from "./profiles";

function requireOwner(ctx: Ctx) {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can change clients and items");
}

async function log(db: Db, ctx: Ctx, action: string, entityType: string, entityId: string, details: unknown) {
  await db.insert(auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action, entityType, entityId, details });
}

const isUnique = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

// ---------------------------------------------------------------- usage

export async function partyUsed(db: Db, companyId: string, partyId: string): Promise<boolean> {
  const [[o], [d]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(orderRevisions).where(and(eq(orderRevisions.companyId, companyId), eq(orderRevisions.partyId, partyId))),
    db.select({ n: sql<number>`count(*)::int` }).from(dispatchRevisions).where(and(eq(dispatchRevisions.companyId, companyId), eq(dispatchRevisions.partyId, partyId))),
  ]);
  return o.n + d.n > 0;
}

/** `stockId`: the firm holding the item. Orders and dispatches of any firm sharing that godown count. */
export async function itemUsed(db: Db, stockId: string, itemId: string): Promise<boolean> {
  const companyId = stockId;
  const [[o], [d], [s]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(orderLineVersions).where(eq(orderLineVersions.itemId, itemId)),
    db.select({ n: sql<number>`count(*)::int` }).from(dispatchLines).where(eq(dispatchLines.itemId, itemId)),
    db.select({ n: sql<number>`count(*)::int` }).from(stockMovements).where(and(eq(stockMovements.companyId, companyId), eq(stockMovements.itemId, itemId))),
  ]);
  return o.n + d.n + s.n > 0;
}

// ---------------------------------------------------------------- parties

export async function partiesForManage(db: Db, ctx: Ctx) {
  requireOwner(ctx);
  const [ps, as] = await Promise.all([
    db.select().from(parties).where(eq(parties.companyId, ctx.companyId)).orderBy(asc(parties.name)),
    db.select().from(partyAliases).where(eq(partyAliases.companyId, ctx.companyId)),
  ]);
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    city: p.city,
    state: p.state,
    taxIdType: p.taxIdType as "gstin" | "aadhaar" | null,
    /** GSTIN in full, Aadhaar masked. */
    taxId: safeTaxId(p.taxIdType, p.taxId),
    active: p.active,
    aliases: as.filter((a) => a.partyId === p.id).map((a) => ({ id: a.id, alias: a.alias })) }));
}

async function assertNameFree(db: Db, ctx: Ctx, table: "party" | "item", name: string, exceptId: string) {
  const n = normalizeName(name);
  const rows =
    table === "party"
      ? await db.select({ id: parties.id, name: parties.name }).from(parties).where(and(eq(parties.companyId, ctx.companyId), ne(parties.id, exceptId)))
      : await db.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.companyId, stockOf(ctx)), ne(items.id, exceptId)));
  if (rows.some((r) => normalizeName(r.name) === n)) throw new LedgerError("DUPLICATE_NAME", "That name is already used");
}

async function addAliasRow(db: Db, ctx: Ctx, kind: "party" | "item", ownerId: string, alias: string) {
  const a = alias.trim();
  if (!a) return;
  try {
    if (kind === "party") await db.insert(partyAliases).values({ companyId: ctx.companyId, partyId: ownerId, alias: a, normalized: normalizeName(a), createdBy: ctx.userId });
    else await db.insert(itemAliases).values({ companyId: stockOf(ctx), itemId: ownerId, alias: a, normalized: normalizeName(a), createdBy: ctx.userId });
  } catch (e) {
    if (isUnique(e)) throw new LedgerError("ALIAS_TAKEN", "That extra name is already used", { alias: a });
    throw e;
  }
}

export async function updateParty(db: Db, ctx: Ctx, partyId: string, input: { name?: string; phone?: string | null; active?: boolean } & PartyProfileInput) {
  requireOwner(ctx);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, ctx.companyId)));
    if (!before) throw new LedgerError("NOT_FOUND", "Client not found");
    const name = input.name?.trim();
    if (name !== undefined && !name) throw new LedgerError("NAME_REQUIRED", "Name is required");
    const renamed = name && normalizeName(name) !== normalizeName(before.name);
    if (renamed) await assertNameFree(tx, ctx, "party", name, partyId);
    const profile = partyProfileSet(input, before.state);
    try {
      await tx
        .update(parties)
        .set({ ...(name ? { name } : {}), ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}), ...(input.active !== undefined ? { active: input.active } : {}), ...profile })
        .where(eq(parties.id, partyId));
    } catch (e) {
      if (isUnique(e)) throw new LedgerError("TAX_ID_TAKEN", "This GSTIN is already saved for another client");
      throw e;
    }
    if (renamed) {
      // Keep the old name so slips and voice notes that use it still match.
      const [taken] = await tx.select({ id: partyAliases.id }).from(partyAliases).where(and(eq(partyAliases.companyId, ctx.companyId), eq(partyAliases.normalized, normalizeName(before.name))));
      if (!taken) await addAliasRow(tx, ctx, "party", partyId, before.name);
    }
    const safe = (x: { city?: string | null; state?: string | null; taxIdType?: string | null; taxId?: string | null }) => ({ city: x.city, state: x.state, taxId: safeTaxId(x.taxIdType, x.taxId) });
    await log(tx, ctx, "party.update", "party", partyId, {
      before: { name: before.name, phone: before.phone, active: before.active, ...safe(before) },
      after: { name: input.name, phone: input.phone, active: input.active, ...safe({ ...before, ...profile }) },
    });
  });
}

export async function addPartyAlias(db: Db, ctx: Ctx, partyId: string, alias: string) {
  requireOwner(ctx);
  const [p] = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, ctx.companyId)));
  if (!p) throw new LedgerError("NOT_FOUND", "Client not found");
  await addAliasRow(db, ctx, "party", partyId, alias);
  await log(db, ctx, "party.alias.add", "party", partyId, { alias });
}

export async function removePartyAlias(db: Db, ctx: Ctx, aliasId: string) {
  requireOwner(ctx);
  const [a] = await db.select().from(partyAliases).where(and(eq(partyAliases.id, aliasId), eq(partyAliases.companyId, ctx.companyId)));
  if (!a) throw new LedgerError("NOT_FOUND", "Not found");
  await db.delete(partyAliases).where(eq(partyAliases.id, aliasId));
  await log(db, ctx, "party.alias.remove", "party", a.partyId, { alias: a.alias });
}

/** Only for clients never used in an order or dispatch; otherwise hide them. */
export async function deleteParty(db: Db, ctx: Ctx, partyId: string) {
  requireOwner(ctx);
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.companyId, ctx.companyId)));
    if (!p) throw new LedgerError("NOT_FOUND", "Client not found");
    if (await partyUsed(tx, ctx.companyId, partyId)) throw new LedgerError("IN_USE", "Already used in orders or dispatches: hide it instead");
    await tx.delete(partyAliases).where(eq(partyAliases.partyId, partyId));
    await tx.delete(parties).where(eq(parties.id, partyId));
    await log(tx, ctx, "party.delete", "party", partyId, { name: p.name });
  });
}

// ---------------------------------------------------------------- items

export async function itemsForManage(db: Db, ctx: Ctx) {
  requireOwner(ctx);
  const [its, as, stock] = await Promise.all([
    db.select().from(items).where(eq(items.companyId, stockOf(ctx))),
    db.select().from(itemAliases).where(eq(itemAliases.companyId, stockOf(ctx))),
    stockOverview(db, ctx),
  ]);
  const st = new Map(stock.map((s) => [s.itemId, s]));
  return its
    .map((i) => ({
      id: i.id,
      name: i.name,
      product: i.product ?? i.name,
      variant: i.variant,
      unit: i.unit,
      active: i.active,
      lowStockLevel: toCenti(i.lowStockLevel),
      inStock: st.get(i.id)?.inStock ?? null,
      free: st.get(i.id)?.free ?? null,
      aliases: as.filter((a) => a.itemId === i.id).map((a) => ({ id: a.id, alias: a.alias })),
    }))
    .sort((a, b) => a.product.localeCompare(b.product) || (a.variant ?? "").localeCompare(b.variant ?? ""));
}

/**
 * Rename one item (or its colour/size), change its unit (only while unused),
 * alert level, or hide/show it.
 */
export async function updateItem(
  db: Db,
  ctx: Ctx,
  itemId: string,
  input: { name?: string; variant?: string | null; unit?: string; lowStockLevel?: string | number; active?: boolean },
) {
  requireOwner(ctx);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.companyId, stockOf(ctx))));
    if (!before) throw new LedgerError("NOT_FOUND", "Item not found");
    const product = before.product ?? before.name;
    const set: Partial<typeof items.$inferInsert> = {};

    // A variant's name follows "Product · Variant"; a plain item is renamed directly.
    let newName: string | undefined;
    if (input.variant !== undefined) {
      const v = input.variant?.trim() || null;
      set.variant = v;
      newName = v ? variantName(product, v) : product;
    } else if (input.name !== undefined) {
      const n = input.name.trim();
      if (!n) throw new LedgerError("NAME_REQUIRED", "Name is required");
      newName = n;
      if (!before.variant) set.product = n;
    }
    if (newName && normalizeName(newName) !== normalizeName(before.name)) {
      await assertNameFree(tx, ctx, "item", newName, itemId);
      set.name = newName;
    } else newName = undefined;

    if (input.unit !== undefined && input.unit.trim() !== before.unit) {
      if (await itemUsed(tx, stockOf(ctx), itemId)) throw new LedgerError("UNIT_LOCKED", "The unit can't change after the item is used");
      set.unit = input.unit.trim() || before.unit;
    }
    if (input.lowStockLevel !== undefined) set.lowStockLevel = centiToDecimal(toCenti(String(input.lowStockLevel)));
    if (input.active !== undefined) set.active = input.active;
    if (Object.keys(set).length) await tx.update(items).set(set).where(eq(items.id, itemId));

    if (newName) {
      const [taken] = await tx.select({ id: itemAliases.id }).from(itemAliases).where(and(eq(itemAliases.companyId, stockOf(ctx)), eq(itemAliases.normalized, normalizeName(before.name))));
      if (!taken) await addAliasRow(tx, ctx, "item", itemId, before.name);
    }
    await log(tx, ctx, "item.update", "item", itemId, {
      before: { name: before.name, variant: before.variant, unit: before.unit, lowStockLevel: before.lowStockLevel, active: before.active },
      after: input,
    });
  });
}

/** Rename a product: every colour/size follows ("Vistara · Red" → "Vistara Plus · Red"). */
export async function renameProduct(db: Db, ctx: Ctx, oldProduct: string, newProduct: string) {
  requireOwner(ctx);
  const np = newProduct.trim();
  if (!np) throw new LedgerError("NAME_REQUIRED", "Name is required");
  return db.transaction(async (tx) => {
    const members = await tx.select().from(items).where(and(eq(items.companyId, stockOf(ctx)), eq(items.product, oldProduct)));
    if (!members.length) throw new LedgerError("NOT_FOUND", "Product not found");
    for (const m of members) {
      const name = m.variant ? variantName(np, m.variant) : np;
      if (normalizeName(name) === normalizeName(m.name)) continue;
      await assertNameFree(tx, ctx, "item", name, m.id);
      await tx.update(items).set({ product: np, name }).where(eq(items.id, m.id));
      const [taken] = await tx.select({ id: itemAliases.id }).from(itemAliases).where(and(eq(itemAliases.companyId, stockOf(ctx)), eq(itemAliases.normalized, normalizeName(m.name))));
      if (!taken) await addAliasRow(tx, ctx, "item", m.id, m.name);
    }
    await log(tx, ctx, "product.rename", "item", members[0].id, { from: oldProduct, to: np, items: members.length });
  });
}

/** Add a colour/size to an existing product, same unit and alert level. */
export async function addVariant(db: Db, ctx: Ctx, product: string, variant: string) {
  requireOwner(ctx);
  const [sibling] = await db.select().from(items).where(and(eq(items.companyId, stockOf(ctx)), eq(items.product, product)));
  if (!sibling) throw new LedgerError("NOT_FOUND", "Product not found");
  const name = variantName(product, variant);
  await assertNameFree(db, ctx, "item", name, "00000000-0000-0000-0000-000000000000");
  return createItem(db, ctx, { name, unit: sibling.unit, product, variant: variant.trim(), lowStockLevel: sibling.lowStockLevel });
}

export async function addItemAlias(db: Db, ctx: Ctx, itemId: string, alias: string) {
  requireOwner(ctx);
  const [it] = await db.select({ id: items.id }).from(items).where(and(eq(items.id, itemId), eq(items.companyId, stockOf(ctx))));
  if (!it) throw new LedgerError("NOT_FOUND", "Item not found");
  await addAliasRow(db, ctx, "item", itemId, alias);
  await log(db, ctx, "item.alias.add", "item", itemId, { alias });
}

export async function removeItemAlias(db: Db, ctx: Ctx, aliasId: string) {
  requireOwner(ctx);
  const [a] = await db.select().from(itemAliases).where(and(eq(itemAliases.id, aliasId), eq(itemAliases.companyId, stockOf(ctx))));
  if (!a) throw new LedgerError("NOT_FOUND", "Not found");
  await db.delete(itemAliases).where(eq(itemAliases.id, aliasId));
  await log(db, ctx, "item.alias.remove", "item", a.itemId, { alias: a.alias });
}

/** Only for items never used in an order, dispatch or stock entry; otherwise hide them. */
export async function deleteItem(db: Db, ctx: Ctx, itemId: string) {
  requireOwner(ctx);
  return db.transaction(async (tx) => {
    const [it] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.companyId, stockOf(ctx))));
    if (!it) throw new LedgerError("NOT_FOUND", "Item not found");
    if (await itemUsed(tx, stockOf(ctx), itemId)) throw new LedgerError("IN_USE", "Already used: hide it instead");
    await tx.delete(itemAliases).where(eq(itemAliases.itemId, itemId));
    await tx.delete(items).where(eq(items.id, itemId));
    await log(tx, ctx, "item.delete", "item", itemId, { name: it.name });
  });
}
