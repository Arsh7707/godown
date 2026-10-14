/**
 * Saved clients and items as spreadsheet rows, with headings the import
 * recognises: download, edit in Excel, import back. Aadhaar is masked (an
 * export is a file that travels); importing the masked value changes nothing.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { itemAliases, items, parties, partyAliases } from "@/db/schema";
import { LedgerError } from "@/lib/errors";
import { formatQty, toCenti } from "@/lib/qty";
import { formatPhone } from "@/lib/phone";
import { maskAadhaar } from "@/lib/india";
import { stockOf, type Ctx } from "@/ledger/service";
import { stockOverview } from "@/stock/service";

export const CLIENT_HEADINGS = ["Name", "Phone", "City", "State", "GSTIN", "Aadhaar", "Other names"] as const;
export const ITEM_HEADINGS = ["Item", "Colour", "Unit", "Stock", "Free", "Low stock level", "Other names"] as const;

export async function exportClients(db: Db, ctx: Ctx): Promise<string[][]> {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can export");
  const [ps, as] = await Promise.all([
    db.select().from(parties).where(and(eq(parties.companyId, ctx.companyId), eq(parties.active, true))).orderBy(asc(parties.name)),
    db.select().from(partyAliases).where(eq(partyAliases.companyId, ctx.companyId)),
  ]);
  return [
    [...CLIENT_HEADINGS],
    ...ps.map((p) => [
      p.name,
      p.phone ? formatPhone(p.phone) : "",
      p.city ?? "",
      p.state ?? "",
      p.taxIdType === "gstin" ? (p.taxId ?? "") : "",
      p.taxIdType === "aadhaar" && p.taxId ? maskAadhaar(p.taxId) : "",
      as.filter((a) => a.partyId === p.id).map((a) => a.alias).join(", "),
    ]),
  ];
}

const signed = (c: number) => (c < 0 ? `-${formatQty(-c)}` : formatQty(c));

export async function exportItems(db: Db, ctx: Ctx): Promise<string[][]> {
  if (ctx.role !== "owner") throw new LedgerError("FORBIDDEN", "Only owners can export");
  const stockId = stockOf(ctx);
  const [its, as, rows] = await Promise.all([
    db.select().from(items).where(and(eq(items.companyId, stockId), eq(items.active, true))),
    db.select().from(itemAliases).where(eq(itemAliases.companyId, stockId)),
    stockOverview(db, ctx),
  ]);
  const item = new Map(its.map((i) => [i.id, i]));
  // One row per item and unit in use (stock in dabba is its own row), in stock-screen order.
  return [
    [...ITEM_HEADINGS],
    ...rows.map((r) => {
      const i = item.get(r.itemId)!;
      return [
        i.product ?? i.name,
        i.variant ?? "",
        r.unit,
        signed(r.inStock),
        signed(r.free),
        r.unitCode === null ? formatQty(toCenti(i.lowStockLevel)) : "",
        r.unitCode === null ? as.filter((a) => a.itemId === r.itemId).map((a) => a.alias).join(", ") : "",
      ];
    }),
  ];
}
