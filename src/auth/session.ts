import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import type { Ctx } from "@/ledger/service";
import { SESSION_TTL_MS, userForToken, type SessionUser } from "./login";

export const SESSION_COOKIE = "ob_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** The logged-in user for this request, or null. Cached per request. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await sessionToken();
  return token ? userForToken(db, token) : null;
});

/** For pages: sends logged-out visitors to the login screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function ctxFor(user: SessionUser): Ctx {
  return { companyId: user.companyId, userId: user.userId, role: user.role, stockId: user.stockId };
}
