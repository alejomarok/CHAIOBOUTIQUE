export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  storageUrl?: string,
): string {
  const storage = storageUrl ? new URL(storageUrl).origin : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Radix positioning and React motion use style attributes.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${storage}`,
    "font-src 'self'",
    `connect-src 'self' ${storage}${development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
