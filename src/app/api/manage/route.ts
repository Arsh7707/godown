import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { createParty } from "@/masters/service";
import {
  addItemAlias,
  addPartyAlias,
  addVariant,
  deleteItem,
  deleteParty,
  removeItemAlias,
  removePartyAlias,
  renameProduct,
  updateItem,
  updateParty,
} from "@/masters/manage";
import { addUser, revealTaxId, updateCompany, updateUser, type Role } from "@/masters/profiles";
import { fail, json, withUser } from "@/lib/api";
import { afterStockChange } from "@/notify/hooks";

/** Owner actions on clients and items (all checks happen in masters/manage.ts). */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const ctx = ctxFor(user);
    const b = (await req.json().catch(() => ({}))) as Record<string, string | boolean | null | undefined>;
    const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
    /** A text field that was sent (string, or null to clear); undefined when absent. */
    const opt = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : b[k] === null ? null : undefined);
    const flag = (k: string) => (typeof b[k] === "boolean" ? (b[k] as boolean) : undefined);
    if (user.role !== "owner") return fail("FORBIDDEN", 403);
    switch (b.action) {
      case "party.create": {
        if (!s("name").trim()) return fail("NAME_REQUIRED");
        const p = await createParty(db, ctx, { name: s("name"), phone: s("phone") || null });
        return json({ ok: true, id: p.id });
      }
      case "party.update":
        await updateParty(db, ctx, s("id"), {
          name: typeof b.name === "string" ? b.name : undefined,
          phone: typeof b.phone === "string" ? b.phone : undefined,
          active: typeof b.active === "boolean" ? b.active : undefined,
          city: opt("city"),
          state: opt("state"),
          taxIdType: b.taxIdType === "gstin" || b.taxIdType === "aadhaar" || b.taxIdType === null ? b.taxIdType : undefined,
          taxId: opt("taxId"),
        });
        return json({ ok: true });
      case "party.taxid.reveal":
        return json({ ok: true, taxId: await revealTaxId(db, ctx, s("id")) });
      case "company.update":
        await updateCompany(db, ctx, { name: opt("name") ?? undefined, city: opt("city"), state: opt("state") });
        return json({ ok: true });
      case "user.add": {
        const u = await addUser(db, ctx, { name: s("name"), phone: s("phone"), role: s("role") as Role, city: opt("city"), state: opt("state"), stockKeeper: flag("stockKeeper") });
        return json({ ok: true, id: u.id });
      }
      case "user.update":
        await updateUser(db, ctx, s("id"), {
          name: opt("name") ?? undefined,
          phone: opt("phone") ?? undefined,
          role: (opt("role") ?? undefined) as Role | undefined,
          city: opt("city"),
          state: opt("state"),
          stockKeeper: flag("stockKeeper"),
          active: flag("active"),
        });
        return json({ ok: true });
      case "party.alias.add":
        await addPartyAlias(db, ctx, s("id"), s("alias"));
        return json({ ok: true });
      case "party.alias.remove":
        await removePartyAlias(db, ctx, s("aliasId"));
        return json({ ok: true });
      case "party.delete":
        await deleteParty(db, ctx, s("id"));
        return json({ ok: true });
      case "item.update":
        await updateItem(db, ctx, s("id"), {
          name: typeof b.name === "string" ? b.name : undefined,
          variant: typeof b.variant === "string" ? b.variant : undefined,
          unit: typeof b.unit === "string" ? b.unit : undefined,
          lowStockLevel: typeof b.lowStockLevel === "string" && b.lowStockLevel ? b.lowStockLevel : undefined,
          active: typeof b.active === "boolean" ? b.active : undefined,
        });
        afterStockChange(user);
        return json({ ok: true });
      case "item.alias.add":
        await addItemAlias(db, ctx, s("id"), s("alias"));
        return json({ ok: true });
      case "item.alias.remove":
        await removeItemAlias(db, ctx, s("aliasId"));
        return json({ ok: true });
      case "item.delete":
        await deleteItem(db, ctx, s("id"));
        return json({ ok: true });
      case "product.rename":
        await renameProduct(db, ctx, s("product"), s("name"));
        return json({ ok: true });
      case "product.addVariant": {
        const it = await addVariant(db, ctx, s("product"), s("variant"));
        return json({ ok: true, id: it.id });
      }
      default:
        return fail("UNKNOWN_ACTION");
    }
  });
}
