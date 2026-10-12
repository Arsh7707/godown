import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { createItem } from "@/masters/service";
import { fail, json, withUser } from "@/lib/api";
import { afterStaffAction } from "@/notify/hooks";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const { name, unit } = (await req.json().catch(() => ({}))) as { name?: string; unit?: string };
    if (!name?.trim()) return fail("NAME_REQUIRED");
    const it = await createItem(db, ctxFor(user), { name: name.trim(), unit: unit?.trim() || "pcs" });
    afterStaffAction(user, { action: "item.create", name: it.name, url: "/stock" });
    return json({ ok: true, item: { id: it.id, name: it.name, unit: it.unit, aliases: [] } });
  });
}
