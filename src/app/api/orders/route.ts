import { saveEntry, type SaveBody } from "@/entries/save";
import { fail, json, withUser } from "@/lib/api";
import { afterLearn, afterStaffAction, afterStockChange } from "@/notify/hooks";
import { picksFrom } from "@/masters/learn";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => null)) as SaveBody | null;
    if (!b?.entryCaptureId || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    const r = await saveEntry(user, "order", b);
    if (!r.result.duplicate) {
      afterStockChange(user);
      afterLearn(user, picksFrom(b));
      afterStaffAction(user, { action: "order.create", partyId: b.partyId, lines: b.lines, url: `/orders/${"orderId" in r.result ? r.result.orderId : ""}` });
    }
    const orderId = "orderId" in r.result ? r.result.orderId : undefined;
    return json({ ok: true, ...r, share: { ...r.share, orderId } });
  });
}
