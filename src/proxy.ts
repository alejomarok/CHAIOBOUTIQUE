import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isSafeInternalPath } from "@/lib/safe-redirect";
import { contentSecurityPolicy } from "@/lib/security-headers";
import { canonicalStorefrontUrl } from "@/lib/canonical-storefront";

// Coarse gate only: an optimistic cookie-presence check, not a permission
// check. The real authorization (requireUser/requirePermission, which can
// hit Postgres) happens in each admin/POS layout or page via
// next/navigation's unauthorized()/forbidden() — see modules/auth. This is
// deliberate: proxy runs on every matched request, so it should stay cheap.
export function proxy(request: NextRequest) {
  const canonical = canonicalStorefrontUrl(
    request.nextUrl,
    process.env.VERCEL_ENV,
    process.env.BETTER_AUTH_URL,
  );
  if (canonical) return NextResponse.redirect(canonical);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    process.env.SUPABASE_URL,
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const protectedPath = /^\/(admin|pos|account)(\/|$)/.test(request.nextUrl.pathname);
  const hasSessionCookie = getSessionCookie(request);

  if (protectedPath && !hasSessionCookie) {
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|images/).*)"],
};
