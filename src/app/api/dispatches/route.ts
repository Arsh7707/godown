import { saveEntry, type SaveBody } from "@/entries/save";
import { fail, json, withUser } from "@/lib/api";
import { afterDispatch } from "@/notify/hooks";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => null)) as SaveBody | null;
    if (!b?.entryCaptureId || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    const r = await saveEntry(user, "dispatch", b);
    if (!r.result.duplicate) afterDispatch(user, b.partyId, b.lines);
    return json({ ok: true, ...r });
  });
}
