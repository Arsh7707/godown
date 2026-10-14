import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { LedgerError } from "@/lib/errors";
import { currentUser } from "@/auth/session";
import type { SessionUser } from "@/auth/login";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const fail = (code: string, status = 400, extra: Record<string, unknown> = {}) => json({ ok: false, code, ...extra }, status);

/** Header the app sends with the firm its screen was opened in (see client/api.ts). */
export const FIRM_HEADER = "x-godown-firm";

/**
 * Runs an API handler for a logged-in user; ledger rule violations become 4xx with their code.
 * A request made from a screen of another firm (the login switched firm since,
 * e.g. in another window) is refused, so nothing is saved into the wrong firm.
 */
export async function withUser(fn: (user: SessionUser) => Promise<Response>): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail("UNAUTHENTICATED", 401);
  const firm = (await headers()).get(FIRM_HEADER);
  if (firm && firm !== user.companyId) return fail("FIRM_CHANGED", 409, { firm: user.companyId, firmName: user.companyName });
  try {
    return await fn(user);
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.code, e.code === "FORBIDDEN" || e.code === "NOT_OWN_ENTRY" || e.code === "EDIT_WINDOW_CLOSED" ? 403 : 422, { message: e.message, details: e.details });
    throw e;
  }
}
