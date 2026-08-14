"use server";

import { isSafeInternalPath } from "@/lib/safe-redirect";
import { timed } from "@/lib/timing";
import {
  getCurrentUser,
  isAuthorizedForPath,
  resolvePostLoginDestination,
} from "@/modules/auth";

// Re-derives the session server-side (never trusts client-submitted
// permissions/roles) to decide where a just-authenticated user should land.
// Called from LoginForm right after every successful sign-in — the client
// never decides this on its own, since only the server actually knows the
// account's real permissions. `requestedRedirect` is the raw, untrusted
// `redirectTo` query param; it's only ever honored if it's BOTH
// same-origin-safe (isSafeInternalPath) AND a destination this specific
// user is authorized to land on (isAuthorizedForPath) — a syntactically
// safe path is not automatically an authorized one, and neither check
// alone is enough. See modules/auth/post-login-redirect.ts.
export async function resolvePostLoginDestinationAction(
  requestedRedirect?: string | null,
): Promise<string> {
  return timed("login.resolvePostLoginDestinationAction", async () => {
    const user = await getCurrentUser();
    if (!user) return "/login";

    if (isSafeInternalPath(requestedRedirect) && isAuthorizedForPath(requestedRedirect, user)) {
      return requestedRedirect;
    }

    return resolvePostLoginDestination(user);
  });
}
