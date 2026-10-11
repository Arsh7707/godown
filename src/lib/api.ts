import "server-only";
import { NextResponse } from "next/server";
import { LedgerError } from "@/lib/errors";
import { currentUser } from "@/auth/session";
import type { SessionUser } from "@/auth/login";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const fail = (code: string, status = 400, extra: Record<string, unknown> = {}) => json({ ok: false, code, ...extra }, status);

/** Runs an API handler for a logged-in user; ledger rule violations become 4xx with their code. */
export async function withUser(fn: (user: SessionUser) => Promise<Response>): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail("UNAUTHENTICATED", 401);
  try {
    return await fn(user);
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.code, e.code === "FORBIDDEN" || e.code === "NOT_OWN_ENTRY" || e.code === "EDIT_WINDOW_CLOSED" ? 403 : 422, { message: e.message, details: e.details });
    throw e;
  }
}
