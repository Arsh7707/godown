import { saveEntry, type SaveBody } from "@/entries/save";
import { fail, json, withUser, readJson } from "@/lib/api";
import { afterDispatch, afterLearn, afterStaffAction } from "@/notify/hooks";
import { picksFrom } from "@/masters/learn";

export async function POST(req: Request) {
  return withUser(async (user) => {
    const b = await readJson<SaveBody>(req);
    if (!b.entryCaptureId || !b.partyId || !b.date || !b.lines?.length) return fail("INCOMPLETE");
    const r = await saveEntry(user, "dispatch", b as SaveBody);
    if (!r.result.duplicate) {
      afterDispatch(user, b.partyId, b.lines);
      afterLearn(user, picksFrom(b));
      afterStaffAction(user, { action: "dispatch.create", partyId: b.partyId, lines: b.lines, url: `/dispatches/${"dispatchId" in r.result ? r.result.dispatchId : ""}` });
    }
    return json({ ok: true, ...r });
  });
}
