import path from "node:path";

import type { NextConfig } from "next";

// Next config files run in Node at build time and can read process.env
// directly — this intentionally doesn't go through src/lib/env.ts (that
// module is server-only application code, not config-load code).
const supabaseHost = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  // Enables next/navigation's forbidden()/unauthorized() + app/forbidden.tsx and
  // app/unauthorized.tsx, used by the authorization layer to return real 403/401
  // responses instead of relying on client-side UI hiding.
  experimental: {
    authInterrupts: true,
    // Product image bytes never go through a Server Action (see
    // modules/products/product-images.ts's direct-to-Supabase signed
    // upload flow) — this only covers ordinary form submissions
    // (product fields, etc.), so a modest bump above the 1 MB default is
    // enough headroom without inviting large-body abuse.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Silences Next's workspace-root inference: an unrelated package-lock.json
  // lives one level up (a sibling project directory), which Turbopack would
  // otherwise guess as the root.
  turbopack: {
    root: path.join(__dirname),
  },
  // Product images live in Supabase Storage — next/image needs the exact
  // host allowlisted. Empty when SUPABASE_URL isn't set yet (e.g. this
  // phase's dev environment without a provisioned Supabase project).
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
};

export default nextConfig;
