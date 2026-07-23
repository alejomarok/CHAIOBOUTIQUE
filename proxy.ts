import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Coarse gate only: an optimistic cookie-presence check, not a permission
// check. The real authorization (requireUser/requirePermission, which can
// hit Postgres) happens in each admin/POS layout or page via
// next/navigation's unauthorized()/forbidden() — see modules/auth. This is
// deliberate: proxy runs on every matched request, so it should stay cheap.
export function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/pos/:path*"],
};
