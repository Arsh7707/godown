import { db } from "@/db/client";
import { webPushSender } from "@/notify/push";
import { sendMorningDigests } from "@/notify/reminders";

/** Called by Vercel Cron every morning (see vercel.json). Vercel sends CRON_SECRET as a bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const send = await webPushSender();
  if (!send) return Response.json({ ok: false, reason: "push not configured" });
  const sent = await sendMorningDigests(db, send);
  return Response.json({ ok: true, sent });
}
