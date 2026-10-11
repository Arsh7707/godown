import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { updateItemSettings } from "@/masters/service";
import { json, withUser } from "@/lib/api";
import { afterStockChange } from "@/notify/hooks";

/** Low-stock alert level and extra names (aliases) for an item. Owners only. */
export async function POST(req: Request, { params }: RouteContext<"/api/items/[id]/settings">) {
  const { id } = await params;
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { lowStockLevel?: string; addAliases?: string[] };
    await updateItemSettings(db, ctxFor(user), id, { lowStockLevel: b.lowStockLevel || undefined, addAliases: b.addAliases });
    afterStockChange(user);
    return json({ ok: true });
  });
}
