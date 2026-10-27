import { env } from "@/lib/env-core";

let check: Promise<boolean> | null = null;
let expiresAt = 0;

// A global provider failure must produce the same answer for every address,
// before Better Auth looks up an account. Better Auth intentionally masks
// individual delivery errors to avoid revealing whether an account exists.
export function isEmailDeliveryAvailable(): Promise<boolean> {
  if (env.EMAIL_PROVIDER !== "resend") return Promise.resolve(true);
  if (!env.RESEND_API_KEY) return Promise.resolve(false);
  if (check && Date.now() < expiresAt) return check;
  expiresAt = Date.now() + 60_000;
  check = fetch("https://api.resend.com/domains?limit=1", {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  })
    .then(async (response) => {
      if (response.ok) return true;
      const error = (await response.json()) as { name?: unknown };
      return (
        (response.status === 401 && error.name === "restricted_api_key") ||
        (response.status === 403 && error.name === "invalid_permission")
      );
    })
    .catch(() => false);
  // A sending-only key receives 401/restricted_api_key from domain reads.
  // Invalid keys, inactive keys and provider errors must remain unavailable.
  return check;
}
