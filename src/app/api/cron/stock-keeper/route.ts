import { db } from "@/db/client";
import { webPushSender } from "@/notify/push";
import { sendStockKeeperReminders } from "@/notify/reminders";

/** Called by Vercel Cron at 11 AM IST (see vercel.json). Vercel sends CRON_SECRET as a bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const send = await webPushSender();
  if (!send) return Response.json({ ok: false, reason: "push not configured" });
  return Response.json({ ok: true, sent: await sendStockKeeperReminders(db, send) });
}
