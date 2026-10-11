/**
 * Web Push delivery. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY;
 * without them every send is a no-op, so the app works the same with
 * reminders switched off.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/types";
import { pushSubscriptions, users } from "@/db/schema";

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one message; "gone" means the phone unsubscribed and the row can go. */
export type PushSender = (target: PushTarget, msg: PushMessage) => Promise<"ok" | "gone" | "error">;

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

let cached: PushSender | null | undefined;

/** The real sender, or null when push isn't configured. */
export async function webPushSender(): Promise<PushSender | null> {
  if (cached !== undefined) return cached;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (cached = null);
  const webpush = (await import("web-push")).default;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const subject = process.env.VAPID_SUBJECT || (host ? `https://${host}` : "https://localhost");
  webpush.setVapidDetails(subject, pub, priv);
  cached = async (t, msg) => {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "normal" });
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) return "gone";
      console.error("push failed", code, (e as Error).message);
      return "error";
    }
  };
  return cached;
}

/** Owners of a company, optionally leaving out the person who caused the alert. */
export async function ownerIds(db: Db, companyId: string, except?: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "owner"), eq(users.active, true), except ? ne(users.id, except) : undefined));
  return rows.map((r) => r.id);
}

/** Sends a message (built per user, so each gets their own language) to every phone those users subscribed. */
export async function notifyUsers(
  db: Db,
  send: PushSender,
  companyId: string,
  userIds: string[],
  build: (user: { id: string; language: "hi" | "en" }) => PushMessage | null,
): Promise<number> {
  if (!userIds.length) return 0;
  const subs = await db
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth, language: users.language })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(and(eq(pushSubscriptions.companyId, companyId), inArray(pushSubscriptions.userId, userIds), eq(users.active, true)));
  let sent = 0;
  const gone: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const msg = build({ id: s.userId, language: s.language });
      if (!msg) return;
      const r = await send(s, msg);
      if (r === "gone") gone.push(s.id);
      if (r === "ok") {
        ok.push(s.id);
        sent++;
      }
    }),
  );
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (ok.length) await db.update(pushSubscriptions).set({ lastSentAt: new Date() }).where(inArray(pushSubscriptions.id, ok));
  return sent;
}

/** Saves (or moves to this user) a phone's subscription. */
export async function saveSubscription(db: Db, user: { userId: string; companyId: string }, t: PushTarget, userAgent: string | null) {
  await db
    .insert(pushSubscriptions)
    .values({ companyId: user.companyId, userId: user.userId, endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { companyId: user.companyId, userId: user.userId, p256dh: t.p256dh, auth: t.auth, userAgent },
    });
}

export async function removeSubscription(db: Db, userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}
