/**
 * Web Push delivery. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY;
 * without them every send is a no-op, so the app works the same with
 * reminders switched off.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { companies, pushSubscriptions, users } from "@/db/schema";

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

/** Link that opens `url` inside firm `companyId`, switching to it first if needed. */
export const firmUrl = (companyId: string, url: string) => `/firm/switch?to=${companyId}&next=${encodeURIComponent(url)}`;

/**
 * Sends a message (built per user, so each gets their own language) to every
 * phone those users subscribed.
 *
 * One person can be in several firms (one user row per firm, same phone),
 * but a phone subscribes once, under whichever firm it was in. So the message
 * goes to the person: every subscription of any of their user rows. When they
 * have more than one firm, the title starts with the firm's name and tapping
 * it opens that firm. Each person gets a message once, even if listed twice.
 */
export async function notifyUsers(
  db: Db,
  send: PushSender,
  userIds: string[],
  build: (user: { id: string; language: "hi" | "en" }) => PushMessage | null,
): Promise<number> {
  if (!userIds.length) return 0;
  const recipients = await db
    .select({ id: users.id, phone: users.phone, language: users.language, companyId: users.companyId, firmName: companies.name })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(and(inArray(users.id, [...new Set(userIds)]), eq(users.active, true)));
  // In the order given: the first row for a phone decides the firm and language.
  const order = new Map<string, number>();
  userIds.forEach((id, i) => order.has(id) || order.set(id, i));
  recipients.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const byPhone = new Map<string, (typeof recipients)[number]>();
  for (const r of recipients) if (!byPhone.has(r.phone)) byPhone.set(r.phone, r);
  if (!byPhone.size) return 0;

  const rows = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(and(inArray(users.phone, [...byPhone.keys()]), eq(users.active, true)));
  const phoneOf = new Map(rows.map((r) => [r.id, r.phone]));
  const firmCount = new Map<string, number>();
  for (const r of rows) firmCount.set(r.phone, (firmCount.get(r.phone) ?? 0) + 1);

  const subs = await db
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, rows.map((r) => r.id)));
  let sent = 0;
  const gone: string[] = [];
  const ok: string[] = [];
  const built = new Map<string, PushMessage | null>();
  await Promise.all(
    subs.map(async (s) => {
      const phone = phoneOf.get(s.userId)!;
      const r = byPhone.get(phone)!;
      if (!built.has(phone)) {
        const msg = build({ id: r.id, language: r.language });
        const several = (firmCount.get(phone) ?? 0) > 1;
        built.set(
          phone,
          msg && several ? { ...msg, title: `${r.firmName} · ${msg.title}`, url: firmUrl(r.companyId, msg.url), tag: msg.tag && `${msg.tag}-${r.companyId}` } : msg,
        );
      }
      const msg = built.get(phone);
      if (!msg) return;
      const res = await send(s, msg);
      if (res === "gone") gone.push(s.id);
      if (res === "ok") {
        ok.push(s.id);
        sent++;
      }
    }),
  );
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (ok.length) await db.update(pushSubscriptions).set({ lastSentAt: new Date() }).where(inArray(pushSubscriptions.id, ok));
  return sent;
}

/**
 * Owners of every firm sharing a godown (stock firm first), for stock alerts.
 * `exceptPhone` leaves out the person who caused the alert, in all their firms.
 */
export async function poolOwnerIds(db: Db, stockId: string, exceptPhone?: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(
      and(
        sql`(${companies.id} = ${stockId} or ${companies.stockCompanyId} = ${stockId})`,
        eq(users.role, "owner"),
        eq(users.active, true),
        exceptPhone ? ne(users.phone, exceptPhone) : undefined,
      ),
    );
  return rows.sort((a, b) => Number(b.companyId === stockId) - Number(a.companyId === stockId)).map((r) => r.id);
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
