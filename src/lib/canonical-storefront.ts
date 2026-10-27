// Only project-hosted production pages redirect. Preview deployments and local
// development remain separate; no host supplied by a client becomes trusted.
export function canonicalStorefrontUrl(
  requestUrl: URL,
  vercelEnvironment?: string,
  configuredUrl?: string,
): URL | null {
  if (
    vercelEnvironment !== "production" ||
    !configuredUrl ||
    !requestUrl.hostname.endsWith(".vercel.app")
  )
    return null;
  const canonical = new URL(configuredUrl);
  if (
    canonical.protocol !== "https:" ||
    canonical.username ||
    canonical.password ||
    requestUrl.origin === canonical.origin
  )
    return null;
  const target = new URL(requestUrl);
  target.protocol = canonical.protocol;
  target.host = canonical.host;
  return target;
}
