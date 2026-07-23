import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables next/navigation's forbidden()/unauthorized() + app/forbidden.tsx and
  // app/unauthorized.tsx, used by the authorization layer to return real 403/401
  // responses instead of relying on client-side UI hiding.
  experimental: {
    authInterrupts: true,
  },
  // Silences Next's workspace-root inference: an unrelated package-lock.json
  // lives one level up (a sibling project directory), which Turbopack would
  // otherwise guess as the root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
