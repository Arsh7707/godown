import { saveEntry, type SaveBody } from "@/entries/save";
import { fail, json, withUser } from "@/lib/api";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => null)) as SaveBody | null;
    if (!b?.entryCaptureId || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    return json({ ok: true, ...(await saveEntry(user, "dispatch", b)) });
  });
}
