import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { createProduct } from "@/masters/service";
import { fail, json, withUser } from "@/lib/api";

/** New product, with one item per colour/size if given. Owners only. */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { name?: string; unit?: string; variants?: string[]; lowStockLevel?: string };
    if (!b.name?.trim()) return fail("NAME_REQUIRED");
    const created = await createProduct(db, ctxFor(user), { name: b.name, unit: b.unit?.trim() || "pcs", variants: b.variants, lowStockLevel: b.lowStockLevel || undefined });
    return json({ ok: true, items: created.map((i) => ({ id: i.id, name: i.name, unit: i.unit, aliases: [] })) });
  });
}
