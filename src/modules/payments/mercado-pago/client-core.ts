import { MercadoPagoConfig, MPNotFoundError, Payment, Preference } from "mercadopago";

import { env } from "@/lib/env-core";

import { getMercadoPagoConfig } from "./config-core";
import { mercadoPagoAmountToMinorUnits, minorUnitsToMercadoPagoAmount } from "./amount-core";
import { FakeMercadoPagoClient } from "./fake-client-core";
import type { CreateProviderPreferenceInput, MercadoPagoClient, ProviderPayment, ProviderPreference } from "./types";

// Node-safe core: no "server-only" import — mirrors modules/storage's
// provider.ts/supabase-provider.ts exact interface+impl+test-injection
// split. Real network calls to Mercado Pago live ONLY here and in
// fake-client-core.ts's in-memory counterpart — every other file in this
// integration talks to the MercadoPagoClient interface, never the
// `mercadopago` SDK directly (see this integration's "avoid over-
// engineering a generic multi-provider framework, but keep provider API
// calls isolated" requirement).

// Real, current Mercado Pago Node.js SDK (`mercadopago` npm package,
// MercadoPagoConfig + Preference + Payment classes) — verified against the
// actually-installed package version, not copied from a possibly-outdated
// example. One MercadoPagoConfig instance per call: the access token is
// read fresh from getMercadoPagoConfig() each time rather than cached at
// module-load time, so a config change never requires a process restart to
// take effect in a long-running dev server.
export class RealMercadoPagoClient implements MercadoPagoClient {
  private buildConfig(): MercadoPagoConfig {
    const { accessToken } = getMercadoPagoConfig();
    return new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
  }

  async createPreference(input: CreateProviderPreferenceInput): Promise<ProviderPreference> {
    const { environment } = getMercadoPagoConfig();
    const client = this.buildConfig();
    const preference = await new Preference(client).create({
      body: {
        items: [
          {
            id: input.externalReference,
            title: input.title,
            quantity: 1,
            currency_id: input.currency,
            unit_price: minorUnitsToMercadoPagoAmount(input.unitPriceAmount),
          },
        ],
        external_reference: input.externalReference,
        back_urls: {
          success: input.successUrl,
          pending: input.pendingUrl,
          failure: input.failureUrl,
        },
        auto_return: "approved",
        notification_url: input.notificationUrl,
        expires: true,
        expiration_date_from: input.expiresFrom.toISOString(),
        expiration_date_to: input.expiresTo.toISOString(),
      },
      requestOptions: { idempotencyKey: input.idempotencyKey },
    });

    if (!preference.id) {
      throw new Error("Mercado Pago no devolvió un id de preferencia.");
    }
    // TEST credentials only ever produce a usable sandbox_init_point;
    // init_point under a TEST access token 404s. PRODUCTION is the reverse
    // — this environment-driven choice is the whole reason
    // MERCADO_PAGO_ENVIRONMENT is required config rather than sniffed from
    // the token (see config-core.ts's own comment).
    const checkoutUrl = environment === "TEST" ? preference.sandbox_init_point : preference.init_point;
    if (!checkoutUrl) {
      throw new Error("Mercado Pago no devolvió una URL de checkout.");
    }

    return { preferenceId: preference.id, checkoutUrl };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    const client = this.buildConfig();
    let payment;
    try {
      payment = await new Payment(client).get({ id: providerPaymentId });
    } catch (error) {
      if (error instanceof MPNotFoundError) return null;
      throw error;
    }

    if (!payment.id || !payment.status || payment.transaction_amount === undefined || !payment.currency_id) {
      throw new Error(`Respuesta de pago de Mercado Pago incompleta (id ${providerPaymentId}).`);
    }

    return {
      id: String(payment.id),
      status: payment.status,
      statusDetail: payment.status_detail ?? null,
      externalReference: payment.external_reference ?? null,
      amount: mercadoPagoAmountToMinorUnits(payment.transaction_amount),
      currency: payment.currency_id,
      approvedAt: payment.date_approved ? new Date(payment.date_approved) : null,
    };
  }
}

let client: MercadoPagoClient | null = null;

// Selection mirrors modules/storage's getStorageProvider() exactly:
// env.E2E_TEST_MODE (validated, server-only config, only ever "true" when
// set by playwright.config.ts's webServer.env) switches to the in-memory
// fake so the e2e suite never calls the real Mercado Pago API, regardless
// of whether real credentials happen to be configured in the environment.
export function getMercadoPagoClient(): MercadoPagoClient {
  if (!client) {
    client = env.E2E_TEST_MODE ? new FakeMercadoPagoClient() : new RealMercadoPagoClient();
  }
  return client;
}

// Test-only injection point — mirrors modules/storage's
// setStorageProviderForTesting exactly. Never called from application code.
export function setMercadoPagoClientForTesting(testClient: MercadoPagoClient | null): void {
  client = testClient;
}
