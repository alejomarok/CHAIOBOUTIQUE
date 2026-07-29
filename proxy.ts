import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isSafeInternalPath } from "@/lib/safe-redirect";

// Coarse gate only: an optimistic cookie-presence check, not a permission
// check. The real authorization (requireUser/requirePermission, which can
// hit Postgres) happens in each admin/POS layout or page via
// next/navigation's unauthorized()/forbidden() — see modules/auth. This is
// deliberate: proxy runs on every matched request, so it should stay cheap.
export function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // request.nextUrl.pathname is already same-origin by construction (it's
    // Next's own matched route, never an external string) — this check is
    // defense in depth, not the only thing standing between an attacker and
    // an open redirect. See LoginForm for the check that actually matters:
    // it's the one reading a redirectTo an attacker could have crafted.
    if (isSafeInternalPath(request.nextUrl.pathname)) {
      loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/pos/:path*"],
};
