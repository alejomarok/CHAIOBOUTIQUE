import type {
  ArcaEnvironment,
  FiscalTaxCategory,
  IssuerVatCondition,
  StoreConfiguration,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { recordAuditLog } from "@/modules/audit/index-core";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// env-core.ts/audit/index-core.ts (not the "server-only"-guarded wrappers)
// so this stays importable from a plain Node context (Playwright's
// test-runner process, modules/orders/order-core.ts) — mirrors the exact
// -core/wrapper split every other feature module uses. See
// modules/store-settings/service.ts, which adds the request-level cache()
// memoization back on top of getStoreConfiguration for Next.js request
// contexts — the plain function here is intentionally uncached.

const STORE_CONFIGURATION_ID = "main";

// A synthetic, NON-PERSISTED default — never written to the database. Only
// returned by getStoreConfiguration() when the real row doesn't exist yet
// (a fresh database before prisma/seed.ts has run, or `next build`'s
// static-generation probe running against an environment that hasn't been
// seeded/migrated — see that seed's own "1 row: StoreConfiguration" step).
// Every nullable field is genuinely unconfigured (null), matching exactly
// what a freshly-seeded row would look like; only the 4 required fields get
// real values, from the same STORE_* env vars the seed itself uses.
function buildDefaultStoreConfiguration(): StoreConfiguration {
  return {
    id: STORE_CONFIGURATION_ID,
    name: env.STORE_NAME,
    currency: env.STORE_CURRENCY,
    locale: env.STORE_LOCALE,
    timezone: env.STORE_TIMEZONE,
    homeDeliveryFlatFeeAmount: null,
    homeDeliveryPostalCodes: null,
    homeDeliveryEstimate: null,
    pickupInstructions: null,
    publicPhone: null,
    whatsappPhone: null,
    publicEmail: null,
    instagramUrl: null,
    facebookUrl: null,
    tiktokUrl: null,
    fiscalLegalName: null,
    fiscalTaxId: null,
    fiscalDefaultPointOfSale: null,
    issuerVatCondition: null,
    fiscalAddress: null,
    fiscalActivityStartDate: null,
    fiscalGrossIncomeId: null,
    arcaPointOfSale: null,
    arcaEnvironment: null,
    defaultTaxCategory: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Read-only — see this phase's explicit "a function named 'get' must never
// write to the database" correction. Previously used prisma.storeConfiguration
// .upsert(...), which meant every read (including `next build`'s
// static-generation probe of /cart and every other public route) attempted
// an INSERT — the exact call that failed the production build against a
// misconfigured DATABASE_URL, and more generally the wrong thing for a
// function whose whole contract is "read the current configuration."
// findUnique + a non-persisted fallback default keeps every caller
// (cart/checkout/footer/fiscal code) working even before the row exists,
// without ever writing during a read. The real row is created lazily, by
// prisma/seed.ts (normal path) or by updateStoreConfiguration's own upsert
// the first time an authorized administrator explicitly saves settings
// (fallback path) — never by this function.
export async function getStoreConfiguration(): Promise<StoreConfiguration> {
  const existing = await prisma.storeConfiguration.findUnique({
    where: { id: STORE_CONFIGURATION_ID },
  });
  if (existing) return existing;

  console.warn(
    "StoreConfiguration row is missing — returning a non-persisted default derived from STORE_* env " +
      "vars. Expected only before prisma/seed.ts has run against this database; if this persists in a " +
      "real environment, run the seed or save the settings form once.",
  );
  return buildDefaultStoreConfiguration();
}

// A true partial update — every field is optional, undefined means "leave
// this alone". The existing store-details form always sends
// name/currency/locale/timezone together (its own schema requires all
// four); the delivery-settings form (see app/(admin)/admin/settings/
// delivery-settings-form.tsx) sends only homeDeliveryFlatFeeAmount/
// pickupInstructions — neither has to resend fields it doesn't own just to
// satisfy this function's shape.
export interface UpdateStoreConfigurationInput {
  name?: string;
  currency?: string;
  locale?: string;
  timezone?: string;
  // Phase — Online Orders & Checkout foundation. See
  // StoreConfiguration.homeDeliveryFlatFeeAmount/pickupInstructions's own
  // schema comments. null clears the value (e.g. disabling home delivery);
  // undefined leaves it untouched.
  homeDeliveryFlatFeeAmount?: bigint | null;
  homeDeliveryPostalCodes?: string | null;
  homeDeliveryEstimate?: string | null;
  pickupInstructions?: string | null;
  // Phase — Public Footer Redesign. See the schema's own comments on these
  // fields — same null-clears/undefined-leaves-untouched posture as above.
  publicPhone?: string | null;
  whatsappPhone?: string | null;
  publicEmail?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  // Phase — Fiscal Invoicing Foundation. See the schema's own comments —
  // same null-clears/undefined-leaves-untouched posture as above. All
  // genuinely optional; never invented, may stay blank indefinitely.
  fiscalLegalName?: string | null;
  fiscalTaxId?: string | null;
  fiscalDefaultPointOfSale?: string | null;
  // Phase — ARCA Fiscal Readiness + Tax Model. See the schema's own
  // comments — same null-clears/undefined-leaves-untouched posture as
  // above. issuerVatCondition/arcaPointOfSale/arcaEnvironment feed
  // arca/readiness-core.ts's getArcaDataReadiness — never invented, may
  // stay blank indefinitely (ARCA stays disabled until all are set).
  issuerVatCondition?: IssuerVatCondition | null;
  fiscalAddress?: string | null;
  fiscalActivityStartDate?: Date | null;
  fiscalGrossIncomeId?: string | null;
  arcaPointOfSale?: number | null;
  arcaEnvironment?: ArcaEnvironment | null;
  // Phase — ARCA Fiscal Readiness correction pass. A convenient store-wide
  // default (e.g. clothing at IVA 21%) — never presented as accounting/tax
  // advice (see the admin form's own disclaimer copy); an authorized
  // administrator (settings.manage) is always the one who sets it. Changing
  // this NEVER rewrites a historical SaleItem's own tax snapshot (see that
  // model's schema comment) — it only affects Sales created from this
  // point forward.
  defaultTaxCategory?: FiscalTaxCategory | null;
}

export async function updateStoreConfiguration(
  input: UpdateStoreConfigurationInput,
  actorId: string,
): Promise<void> {
  const before = await getStoreConfiguration();

  // Partial-update fields — shared between upsert's `update` (applied when
  // the row already exists) and folded into `create` below (applied the
  // first time an administrator saves settings against a database whose
  // seed hasn't run yet). Undefined still means "leave this alone" for an
  // existing row; for a brand-new row it simply leaves the column at its
  // nullable default (NULL), same as a freshly-seeded row would have.
  const partialData = {
    ...(input.homeDeliveryPostalCodes !== undefined
      ? { homeDeliveryPostalCodes: input.homeDeliveryPostalCodes }
      : {}),
    ...(input.homeDeliveryEstimate !== undefined
      ? { homeDeliveryEstimate: input.homeDeliveryEstimate }
      : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.homeDeliveryFlatFeeAmount !== undefined
      ? { homeDeliveryFlatFeeAmount: input.homeDeliveryFlatFeeAmount }
      : {}),
    ...(input.pickupInstructions !== undefined
      ? { pickupInstructions: input.pickupInstructions }
      : {}),
    ...(input.publicPhone !== undefined ? { publicPhone: input.publicPhone } : {}),
    ...(input.whatsappPhone !== undefined ? { whatsappPhone: input.whatsappPhone } : {}),
    ...(input.publicEmail !== undefined ? { publicEmail: input.publicEmail } : {}),
    ...(input.instagramUrl !== undefined ? { instagramUrl: input.instagramUrl } : {}),
    ...(input.facebookUrl !== undefined ? { facebookUrl: input.facebookUrl } : {}),
    ...(input.tiktokUrl !== undefined ? { tiktokUrl: input.tiktokUrl } : {}),
    ...(input.fiscalLegalName !== undefined ? { fiscalLegalName: input.fiscalLegalName } : {}),
    ...(input.fiscalTaxId !== undefined ? { fiscalTaxId: input.fiscalTaxId } : {}),
    ...(input.fiscalDefaultPointOfSale !== undefined
      ? { fiscalDefaultPointOfSale: input.fiscalDefaultPointOfSale }
      : {}),
    ...(input.issuerVatCondition !== undefined
      ? { issuerVatCondition: input.issuerVatCondition }
      : {}),
    ...(input.fiscalAddress !== undefined ? { fiscalAddress: input.fiscalAddress } : {}),
    ...(input.fiscalActivityStartDate !== undefined
      ? { fiscalActivityStartDate: input.fiscalActivityStartDate }
      : {}),
    ...(input.fiscalGrossIncomeId !== undefined
      ? { fiscalGrossIncomeId: input.fiscalGrossIncomeId }
      : {}),
    ...(input.arcaPointOfSale !== undefined ? { arcaPointOfSale: input.arcaPointOfSale } : {}),
    ...(input.arcaEnvironment !== undefined ? { arcaEnvironment: input.arcaEnvironment } : {}),
    ...(input.defaultTaxCategory !== undefined
      ? { defaultTaxCategory: input.defaultTaxCategory }
      : {}),
  };

  // upsert, not update: getStoreConfiguration() is now read-only and never
  // creates the row (see that function's own comment), so this mutation
  // path is the one place — an authorized administrator explicitly saving
  // settings — allowed to create it. `create` guarantees the 4 required
  // fields via the same STORE_* env fallback the old read-side upsert and
  // prisma/seed.ts both use, so a save against a not-yet-seeded database
  // still produces a valid row rather than a Prisma validation error.
  await prisma.storeConfiguration.upsert({
    where: { id: STORE_CONFIGURATION_ID },
    update: partialData,
    create: {
      id: STORE_CONFIGURATION_ID,
      name: env.STORE_NAME,
      currency: env.STORE_CURRENCY,
      locale: env.STORE_LOCALE,
      timezone: env.STORE_TIMEZONE,
      ...partialData,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "store_settings.updated",
    entityType: "StoreConfiguration",
    entityId: STORE_CONFIGURATION_ID,
    previousValue: {
      name: before.name,
      currency: before.currency,
      locale: before.locale,
      timezone: before.timezone,
      homeDeliveryFlatFeeAmount: before.homeDeliveryFlatFeeAmount?.toString() ?? null,
      pickupInstructions: before.pickupInstructions,
      publicPhone: before.publicPhone,
      whatsappPhone: before.whatsappPhone,
      publicEmail: before.publicEmail,
      instagramUrl: before.instagramUrl,
      facebookUrl: before.facebookUrl,
      tiktokUrl: before.tiktokUrl,
      fiscalLegalName: before.fiscalLegalName,
      fiscalTaxId: before.fiscalTaxId,
      fiscalDefaultPointOfSale: before.fiscalDefaultPointOfSale,
      issuerVatCondition: before.issuerVatCondition,
      fiscalAddress: before.fiscalAddress,
      fiscalActivityStartDate: before.fiscalActivityStartDate?.toISOString() ?? null,
      fiscalGrossIncomeId: before.fiscalGrossIncomeId,
      arcaPointOfSale: before.arcaPointOfSale,
      arcaEnvironment: before.arcaEnvironment,
      defaultTaxCategory: before.defaultTaxCategory,
    },
    newValue: {
      ...input,
      homeDeliveryFlatFeeAmount: input.homeDeliveryFlatFeeAmount?.toString(),
      fiscalActivityStartDate: input.fiscalActivityStartDate?.toISOString(),
    },
  });
}
