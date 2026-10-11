import { db } from "@/db/client";
import { messages } from "@/i18n/messages";
import { notifyUsers, webPushSender } from "@/notify/push";
import { fail, json, withUser } from "@/lib/api";

/** Sends a test reminder to the current user's phones. */
export async function POST() {
  return withUser(async (user) => {
    const send = await webPushSender();
    if (!send) return fail("PUSH_NOT_CONFIGURED", 503);
    const t = messages(user.language).n;
    const sent = await notifyUsers(db, send, user.companyId, [user.userId], () => ({ title: t.testTitle, body: t.testBody, url: "/", tag: "test" }));
    return json({ ok: sent > 0, sent });
  });
}
