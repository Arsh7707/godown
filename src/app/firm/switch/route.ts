import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { currentUser } from "@/auth/session";
import { switchFirm } from "@/masters/firms";
import { LedgerError } from "@/lib/errors";

/**
 * Opened from a reminder about one firm while the app may be in another:
 * switch to that firm (only if this person is in it), then open the page.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const nextRaw = req.nextUrl.searchParams.get("next") ?? "/";
  // Same-site paths only: "/pending", never "//evil.com" or "https://…".
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") && !nextRaw.startsWith("/\\") ? nextRaw : "/";
  try {
    if (/^[0-9a-f-]{36}$/i.test(to)) await switchFirm(db, user, to);
  } catch (e) {
    // Not in that firm (any more): just open the app where it is.
    if (!(e instanceof LedgerError)) throw e;
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.redirect(new URL(next, req.url));
}
