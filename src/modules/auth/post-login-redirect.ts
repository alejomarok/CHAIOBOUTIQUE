import type { Permission } from "@/modules/permissions/catalog";

// Pure, no "server-only" — deliberately independent of session/DB access so
// this is directly unit-testable against a synthetic role/permission set.
// resolvePostLoginDestinationAction (a Server Action) re-derives the real
// session server-side; this function only decides where to send a user once
// their roles/permissions are already known.
//
// Named-permission priority, never a permission *count*, and CUSTOMER is
// checked by role — never inferred from "has zero permissions" — see
// docs/adr/0003-customer-registration.md. Every current staff role holds
// admin.access (see modules/roles/catalog.ts), so the pos.access branch is
// dormant today — no role has pos.access without also having admin.access
// yet — but it's here, tested, and ready for a future POS-only role rather
// than invented later under time pressure.
//
// "/" is the fallback for an authenticated account this function doesn't
// recognize (e.g. a user with zero roles at all) — never "/account": that
// area doesn't exist until Phase 3C, and redirecting there would 404 every
// customer login. See isAuthorizedForPath below for the matching guard on
// an explicit `redirectTo`.
//
// A CUSTOMER whose email isn't verified yet lands on /verify-email instead
// of /catalog — checked by role, same as the CUSTOMER branch itself, never
// by permission count. Staff roles never carry the CUSTOMER role, so
// requireEmailVerification staying false (see lib/auth-core.ts) plus this
// check is what keeps pre-Phase-3B staff accounts (never emailVerified)
// signing in normally while still steering unverified public customers
// toward verification. /verify-email renders the same "check your email"
// state whether the visitor just registered or is an unverified customer
// returning to log in later — see app/(auth)/verify-email/page.tsx.
export function resolvePostLoginDestination(user: {
  roles: string[];
  permissions: Set<Permission>;
  emailVerified: boolean;
}): string {
  if (user.permissions.has("admin.access")) return "/admin";
  if (user.permissions.has("pos.access")) return "/pos";
  if (user.roles.includes("CUSTOMER")) {
    return user.emailVerified ? "/catalog" : "/verify-email";
  }
  return "/";
}

// Path prefixes that must never be treated as a valid post-login
// destination, no matter who's asking — because the route doesn't exist
// yet, not because of a permission gap. Update this the moment the
// corresponding phase actually ships the route (Phase 3C for /account).
const UNIMPLEMENTED_PATH_PREFIXES = ["/account"];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

// Whether an explicit `redirectTo` (already confirmed same-origin-safe by
// isSafeInternalPath) is one this specific user is actually allowed to
// land on. A syntactically "safe" internal path is not automatically an
// authorized one — /admin is same-origin but a CUSTOMER has no business
// being sent there, even though requirePermission() would also catch it on
// arrival. Checking here means a redirect never even points at a
// known-forbidden or known-unbuilt destination in the first place.
export function isAuthorizedForPath(
  path: string,
  user: { permissions: Set<Permission> },
): boolean {
  if (UNIMPLEMENTED_PATH_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return false;
  }
  if (matchesPrefix(path, "/admin")) return user.permissions.has("admin.access");
  if (matchesPrefix(path, "/pos")) return user.permissions.has("pos.access");
  // Every other internal path (public catalog, product pages, home, ...)
  // needs no special permission for any authenticated account.
  return true;
}
