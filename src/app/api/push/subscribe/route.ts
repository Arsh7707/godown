import { db } from "@/db/client";
import { removeSubscription, saveSubscription, vapidPublicKey } from "@/notify/push";
import { fail, json, withUser } from "@/lib/api";

/** The public key a phone needs to subscribe; null when reminders aren't set up. */
export async function GET() {
  return withUser(async () => json({ ok: true, key: vapidPublicKey() }));
}

interface Body {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

/** This phone wants reminders. Owners and stock keepers: they are the ones reminders go to. */
export async function POST(req: Request) {
  return withUser(async (user) => {
    if (user.role !== "owner" && !user.stockKeeper) return fail("FORBIDDEN", 403);
    const b = (await req.json().catch(() => ({}))) as Body;
    if (!b.endpoint?.startsWith("https://") || !b.keys?.p256dh || !b.keys.auth) return fail("INCOMPLETE");
    await saveSubscription(db, user, { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth }, req.headers.get("user-agent"));
    return json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as Body;
    if (b.endpoint) await removeSubscription(db, user.userId, b.endpoint);
    return json({ ok: true });
  });
}
