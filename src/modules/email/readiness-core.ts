import { env } from "@/lib/env-core";
import { isEmailDeliveryAvailable } from "./availability-core";

export async function getEmailReadiness() {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_TEST_RECIPIENT)
    return {
      provider: "resend",
      deliveryMode: "owner_only",
      keyConfigured: Boolean(env.RESEND_API_KEY),
      providerAuthenticationAvailable: await isEmailDeliveryAvailable(),
      productionCustomerEmailReady: false,
    };
  const senderDomain = env.EMAIL_FROM.split("@")[1].toLowerCase();
  const publicSender =
    !/\.(local|localhost|invalid|test)$/.test(senderDomain) && senderDomain.includes(".");
  if (env.EMAIL_PROVIDER !== "resend")
    return {
      provider: "smtp",
      publicSender,
      authenticationConfigured: Boolean(env.SMTP_USER && env.SMTP_PASSWORD),
    };
  if (!env.RESEND_API_KEY) return { provider: "resend", publicSender, keyConfigured: false };
  try {
    const response = await fetch("https://api.resend.com/domains?limit=100", {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok)
      return {
        provider: "resend",
        publicSender,
        keyConfigured: true,
        verificationStatus: response.status === 403 ? "restricted" : "unavailable",
        providerStatus: response.status,
      };
    const result = (await response.json()) as { data?: { name: string; status: string }[] };
    return {
      provider: "resend",
      publicSender,
      keyConfigured: true,
      senderDomain,
      verificationStatus:
        result.data?.find((domain) => domain.name.toLowerCase() === senderDomain)?.status ??
        "not_found",
    };
  } catch {
    return {
      provider: "resend",
      publicSender,
      keyConfigured: true,
      verificationStatus: "unavailable",
    };
  }
}
