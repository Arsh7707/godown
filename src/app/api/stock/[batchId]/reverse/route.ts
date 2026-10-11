import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { reverseStockEntry } from "@/stock/service";
import { json, withUser } from "@/lib/api";
import { afterStockChange } from "@/notify/hooks";

/** Undo a stock entry (goods in / count / adjustment). */
export async function POST(req: Request, { params }: RouteContext<"/api/stock/[batchId]/reverse">) {
  const { batchId } = await params;
  return withUser(async (user) => {
    const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
    const r = await reverseStockEntry(db, ctxFor(user), batchId, reason ?? null);
    afterStockChange(user);
    return json({ ok: true, batchId: r.batchId });
  });
}
