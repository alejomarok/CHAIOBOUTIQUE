"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Server state is authoritative — this component's only job is to re-fetch
// it periodically while webhook/reconciliation processing may still be in
// flight, never to itself decide anything is confirmed (see this page's own
// "never mark Order PAID simply because of a redirect" requirement). Only
// ever rendered by the server while the Order is still in a non-terminal
// state — see page.tsx — so it naturally stops rendering (and therefore
// polling) the moment a refresh reveals a terminal outcome. Capped at
// MAX_ATTEMPTS so a genuinely stuck webhook (misconfigured notification_url,
// etc.) doesn't poll forever in an open tab.
const MAX_ATTEMPTS = 20;
const INTERVAL_MS = 2500;

export function AutoRefreshWhileProcessing() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (attempt >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => {
      setAttempt((current) => current + 1);
      router.refresh();
    }, INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [attempt, router]);

  return null;
}
