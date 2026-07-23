"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL: requests go to the same origin (/api/auth/*), so no server
// secret or environment variable needs to cross into browser code.
export const authClient = createAuthClient();
