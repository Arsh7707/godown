import { cookies } from "next/headers";
import { db } from "@/db/client";
import { revokeSession } from "@/auth/login";
import { SESSION_COOKIE, sessionToken } from "@/auth/session";
import { json } from "@/lib/api";

export async function POST() {
  const token = await sessionToken();
  if (token) await revokeSession(db, token);
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
