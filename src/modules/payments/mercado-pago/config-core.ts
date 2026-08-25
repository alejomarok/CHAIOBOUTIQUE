import { env } from "@/lib/env-core";

// Node-safe core: no "server-only" import — see this module's index.ts and
// ARCHITECTURE.md's -core/wrapper split. Fail-closed by design: every
// function here either returns a clear "not configured" signal or throws a
// typed error, never falls back to a guessed/default credential.

export class MercadoPagoNotConfiguredError extends Error {
  constructor() {
    super(
      "Mercado Pago no está configurado. Definí MERCADO_PAGO_ACCESS_TOKEN, " +
        "MERCADO_PAGO_WEBHOOK_SECRET y MERCADO_PAGO_ENVIRONMENT.",
    );
    this.name = "MercadoPagoNotConfiguredError";
  }
}

export interface MercadoPagoConfigValues {
  accessToken: string;
  webhookSecret: string;
  environment: "TEST" | "PRODUCTION";
  // Base URL used to build back_urls/notification_url — see
  // MERCADO_PAGO_PUBLIC_BASE_URL's own env-core.ts comment.
  publicBaseUrl: string;
}

// Safe, non-throwing check — used to gate UI (e.g. the public "Pagar con
// Mercado Pago" CTA only renders when this is true; see this integration's
// explicit "Mercado Pago is configured" precondition) without ever risking
// an unhandled throw from a Server Component render path.
export function isMercadoPagoConfigured(): boolean {
  return Boolean(env.MERCADO_PAGO_ACCESS_TOKEN && env.MERCADO_PAGO_WEBHOOK_SECRET && env.MERCADO_PAGO_ENVIRONMENT);
}

// Test-only override — mirrors client-core.ts's setMercadoPagoClientForTesting
// exactly. Root cause this fixes: tests/integration/global-setup.ts used to
// mutate process.env.MERCADO_PAGO_* to satisfy this function, but Vitest's
// globalSetup runs in its OWN process, separate from the worker processes
// that actually execute test files — env-core.ts's `env` object is parsed
// once, per worker process, from that worker's own process.env, which never
// observes a mutation made in a different process. (Contrast with
// scripts/with-test-db.mjs, which sets TEST_DATABASE_URL in the parent shell
// BEFORE spawning `vitest` as a child process — that genuinely is inherited,
// since it happens before process creation rather than after.) The fix:
// inject the resolved config directly, in-process, the same way the fake
// client itself is injected — never rely on cross-process env propagation
// for deterministic test behavior.
let configOverride: MercadoPagoConfigValues | null = null;

export function setMercadoPagoConfigForTesting(testConfig: MercadoPagoConfigValues | null): void {
  configOverride = testConfig;
}

// The throwing variant — for any code path that's about to actually call
// Mercado Pago or validate a webhook and genuinely cannot proceed without
// full configuration. Every field is validated together (never a partial
// config silently used) — a deployment with only an access token and no
// webhook secret, for instance, would be able to create preferences but
// never safely verify a payment, which is a worse and more dangerous state
// than simply refusing to start any of it. Production/runtime behavior is
// completely unaffected by configOverride — it stays null outside a test
// calling setMercadoPagoConfigForTesting, so this still fails closed exactly
// as before when real credentials are genuinely absent.
export function getMercadoPagoConfig(): MercadoPagoConfigValues {
  if (configOverride) return configOverride;
  if (!env.MERCADO_PAGO_ACCESS_TOKEN || !env.MERCADO_PAGO_WEBHOOK_SECRET || !env.MERCADO_PAGO_ENVIRONMENT) {
    throw new MercadoPagoNotConfiguredError();
  }
  return {
    accessToken: env.MERCADO_PAGO_ACCESS_TOKEN,
    webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET,
    environment: env.MERCADO_PAGO_ENVIRONMENT,
    publicBaseUrl: env.MERCADO_PAGO_PUBLIC_BASE_URL ?? env.NEXT_PUBLIC_APP_URL,
  };
}

// For the startup/debug diagnostic banner (see db-core.ts's own "DATABASE:
// LOCAL DEVELOPMENT / REMOTE SUPABASE" banner for the exact precedent this
// mirrors) — a label only, NEVER includes the access token, webhook secret,
// or any other credential value.
export function getMercadoPagoDiagnosticLabel(): string {
  if (!isMercadoPagoConfigured()) return "Mercado Pago: no configurado";
  return `Mercado Pago: ${env.MERCADO_PAGO_ENVIRONMENT}`;
}

const MERCADO_PAGO_ENVIRONMENT_LABELS_ES: Record<"TEST" | "PRODUCTION", string> = {
  TEST: "Pruebas",
  PRODUCTION: "Producción",
};

export interface MercadoPagoReadinessCheck {
  key: "environment" | "accessToken" | "webhookSecret" | "publicBaseUrl";
  ok: boolean;
  label: string;
}

export interface MercadoPagoReadiness {
  // Mirrors isMercadoPagoConfigured() exactly (accessToken + webhookSecret +
  // environment) — publicBaseUrl is deliberately NOT part of this: it's
  // optional and falls back to NEXT_PUBLIC_APP_URL (see that field's own
  // comment above), so its check below is informational only, never a
  // blocker.
  configured: boolean;
  environmentLabel: string;
  checks: MercadoPagoReadinessCheck[];
}

// Admin-settings readiness checklist — booleans and labels ONLY, never a
// credential value (see this integration's own "never log/return a
// secret" posture, same as every other provider readiness check in this
// codebase — e.g. arca/readiness-core.ts's getArcaDataReadiness).
export function getMercadoPagoReadiness(): MercadoPagoReadiness {
  const environment = env.MERCADO_PAGO_ENVIRONMENT ?? null;
  const hasAccessToken = Boolean(env.MERCADO_PAGO_ACCESS_TOKEN);
  const hasWebhookSecret = Boolean(env.MERCADO_PAGO_WEBHOOK_SECRET);
  const hasPublicBaseUrl = Boolean(env.MERCADO_PAGO_PUBLIC_BASE_URL);

  return {
    configured: isMercadoPagoConfigured(),
    environmentLabel: environment ? MERCADO_PAGO_ENVIRONMENT_LABELS_ES[environment] : "sin configurar",
    checks: [
      {
        key: "environment",
        ok: environment !== null,
        label: environment ? `Entorno: ${environment}` : "Entorno no configurado",
      },
      {
        key: "accessToken",
        ok: hasAccessToken,
        label: hasAccessToken ? "Access Token configurado" : "Access Token no configurado",
      },
      {
        key: "webhookSecret",
        ok: hasWebhookSecret,
        label: hasWebhookSecret ? "Webhook Secret configurado" : "Webhook Secret no configurado",
      },
      {
        key: "publicBaseUrl",
        ok: hasPublicBaseUrl,
        label: hasPublicBaseUrl ? "URL pública configurada" : "URL pública no configurada",
      },
    ],
  };
}
