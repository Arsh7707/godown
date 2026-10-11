import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate only: no session cookie → login page. The real check (is the
 * session valid?) happens on the server for every page and API call.
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.has("ob_session")) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/|manifest.webmanifest|sw.js|icons/|favicon.ico|robots.txt).*)"],
};
