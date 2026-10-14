import { db } from "@/db/client";
import { ctxFor } from "@/auth/session";
import { ACTIVITY_GROUPS, activityLog, type ActivityGroup } from "@/ledger/activity";
import { json, withUser } from "@/lib/api";

/** One page of the activity log, newest first; `before` continues an earlier page. */
export async function GET(req: Request) {
  return withUser(async (user) => {
    const q = new URL(req.url).searchParams;
    const group = q.get("group");
    const beforeAt = q.get("beforeAt");
    const beforeId = q.get("beforeId");
    const r = await activityLog(db, ctxFor(user), {
      userId: q.get("userId") || undefined,
      group: group && group in ACTIVITY_GROUPS ? (group as ActivityGroup) : undefined,
      from: q.get("from") || undefined,
      to: q.get("to") || undefined,
      before: beforeAt && beforeId ? { at: beforeAt, id: beforeId } : undefined,
    });
    return json({ ok: true, ...r });
  });
}
