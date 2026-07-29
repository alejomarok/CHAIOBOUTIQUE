// Pure, no "server-only" — used both server-side (a Server Action re-deriving
// a post-login destination) and client-side (LoginForm validating a
// `redirectTo` query param before ever calling router.push with it). See
// SECURITY.md "Open redirect prevention."
//
// True only for a string that is unambiguously an internal, same-origin
// path: exactly one leading "/", never "//" (protocol-relative — browsers
// treat "//evil.com" as "https://evil.com"), never a backslash (some
// browsers normalize "/\evil.com" to "//evil.com" too), and no scheme
// ("javascript:", "https:", etc.) anywhere in the string. Deliberately
// conservative — a path this rejects can just fall back to the safe
// role-based default instead.
export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.startsWith("/\\")) return false;
  if (path.includes(":")) return false;
  return true;
}
