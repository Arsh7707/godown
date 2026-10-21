import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { LedgerError } from "@/lib/errors";
import { currentUser } from "@/auth/session";
import type { SessionUser } from "@/auth/login";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const fail = (code: string, status = 400, extra: Record<string, unknown> = {}) => json({ ok: false, code, ...extra }, status);

/**
 * The request's JSON body as an object; {} when it is missing, not JSON, or
 * not an object (null, a list, a number), so handlers can read fields safely.
 */
export async function readJson<T extends object = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  const b: unknown = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Partial<T>) : {};
}

/** Postgres error code of a failed query, through drizzle's wrapper. */
function pgCode(e: unknown): string | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = x?.cause?.code ?? x?.code;
  return typeof code === "string" ? code : undefined;
}

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
    // A malformed id or value the database can't read (e.g. "abc" for a record id): nothing of ours matches it.
    if (pgCode(e) === "22P02") return fail("INVALID_INPUT", 400);
    if (pgCode(e) === "22003") return fail("INVALID_QTY", 422);
    // A field of the wrong type (a list where a name goes, a number where a list goes) fails
    // on first use. The screens never send that; answer it as bad input, but log it.
    if (e instanceof TypeError) {
      console.error("bad request body", e);
      return fail("INVALID_INPUT", 400);
    }
    throw e;
  }
}
