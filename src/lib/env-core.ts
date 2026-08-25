import { z } from "zod";

// Node-safe core: no "server-only" import. This is the one module in the
// env-validation chain that a CLI script (prisma/seed.ts, run via `tsx`,
// outside the Next.js bundler) is allowed to import directly. src/lib/env.ts
// re-exports this for the rest of the (Next.js) application and adds the
// "server-only" guard back for that context — see that file's comment.

// .env.example documents optional vars as blank ("KEY="), which env-file
// tooling reads as an empty string, not "unset". Without this, every
// optional field below would need to tolerate "" as well as undefined.
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

// Fails fast at boot with a clear message if a required variable is missing,
// instead of letting `undefined` silently reach Prisma/Better Auth. Values
// that are only needed once a specific integration is actually used (Supabase
// Storage, Resend) stay optional here and are validated at the point of use
// instead — see src/modules/storage and src/modules/email.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database (Supabase). See prisma.config.ts and DATABASE.md for why there
  // are two URLs.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  TEST_DATABASE_URL: optional(z.string().min(1)),
  // Optional local Postgres for `npm run dev:local` (see scripts/
  // with-dev-db.mjs and the Local Development Performance checkpoint in
  // DATABASE.md) — never read directly by app code; with-dev-db.mjs forces
  // DATABASE_URL/DIRECT_URL to this value only for the duration of the
  // wrapped command, the same pattern with-test-db.mjs uses for
  // TEST_DATABASE_URL. Plain `npm run dev` is unaffected and keeps using
  // whatever DATABASE_URL/DIRECT_URL are already set to (Supabase by
  // default) — this never silently changes that.
  DEV_DATABASE_URL: optional(z.string().min(1)),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL must be a valid URL"),

  // Supabase Storage — optional here; SupabaseStorageProvider validates its
  // own presence when actually instantiated. SUPABASE_SECRET_KEY (not the
  // legacy SUPABASE_SERVICE_ROLE_KEY name) — Supabase is migrating from
  // anon/service_role JWT keys to publishable/secret keys ahead of the
  // legacy format's deprecation; see SECURITY.md.
  SUPABASE_URL: optional(z.url()),
  SUPABASE_SECRET_KEY: optional(z.string().min(1)),
  SUPABASE_PRODUCT_IMAGES_BUCKET: z.string().min(1).default("product-images"),

  // Public app URL — read directly via process.env.NEXT_PUBLIC_APP_URL in
  // Client Components (Next.js only inlines NEXT_PUBLIC_* when referenced
  // literally); validated here too so a missing value fails fast at boot.
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  // Store
  STORE_NAME: z.string().min(1),
  STORE_CURRENCY: z.string().min(1),
  STORE_LOCALE: z.string().min(1),
  STORE_TIMEZONE: z.string().min(1),

  // Store social/contact presence — Phase: Public Footer Redesign moved
  // this from env vars to StoreConfiguration (see that model's schema
  // comment): a non-technical admin can now edit it live from
  // /admin/settings instead of needing a deploy/restart. No STORE_
  // INSTAGRAM_URL/FACEBOOK_URL/TIKTOK_URL/WHATSAPP_NUMBER/CONTACT_EMAIL/
  // CITY env vars exist anymore — do not reintroduce them here.

  // Initial admin — optional; the seed skips admin creation when absent.
  INITIAL_ADMIN_NAME: optional(z.string().min(1)),
  INITIAL_ADMIN_EMAIL: optional(z.email()),
  INITIAL_ADMIN_PASSWORD: optional(z.string().min(8)),

  // Mercado Pago Checkout Pro — Phase: Mercado Pago Checkout Pro
  // integration. All optional here (fail-closed at the point of use — see
  // modules/payments/mercado-pago/config-core.ts's getMercadoPagoConfig —
  // same posture as Supabase Storage's SUPABASE_URL/SUPABASE_SECRET_KEY):
  // the app must boot and every other feature must keep working even with
  // no Mercado Pago credentials configured at all. Server-only — never
  // prefixed NEXT_PUBLIC_. No MERCADO_PAGO_PUBLIC_KEY: this integration is
  // Checkout Pro via a plain redirect to the preference's checkout URL,
  // never a client-side MP.js SDK / Payment Brick, so a public key is
  // genuinely not needed this phase (see the final report for this
  // decision).
  MERCADO_PAGO_ACCESS_TOKEN: optional(z.string().min(1)),
  MERCADO_PAGO_WEBHOOK_SECRET: optional(z.string().min(1)),
  // Explicit, never sniffed from the access token's own string shape —
  // Mercado Pago's own docs do not guarantee a stable prefix convention
  // across integrations, so guessing TEST vs PRODUCTION from the token
  // would be exactly the kind of "obsolete example" this integration was
  // told not to rely on. Required together with MERCADO_PAGO_ACCESS_TOKEN
  // (enforced in config-core.ts, not here) — used only for the startup
  // diagnostic banner and admin-facing labels, never to change validation
  // behavior.
  MERCADO_PAGO_ENVIRONMENT: optional(z.enum(["TEST", "PRODUCTION"])),
  // Overrides NEXT_PUBLIC_APP_URL for constructing Mercado Pago's
  // back_urls/notification_url ONLY — see this integration's local-webhook-
  // development documentation. Mercado Pago cannot reach
  // http://localhost:3000, so a developer doing a real sandbox test points
  // this at their HTTPS tunnel URL instead of changing NEXT_PUBLIC_APP_URL
  // itself (which affects unrelated things like email links). Falls back to
  // NEXT_PUBLIC_APP_URL when unset — this is the "APP_PUBLIC_URL" concept
  // this integration's spec describes, deliberately reusing the existing
  // app-wide URL setting rather than introducing a second, redundant
  // general-purpose one.
  MERCADO_PAGO_PUBLIC_BASE_URL: optional(z.url()),

  // Shared secret for the protected internal maintenance endpoint (POST
  // /api/internal/expire-stale-orders — see that route's own comment and
  // this integration's "real scheduler preparation" requirement). Optional:
  // when unset, the endpoint refuses every request (fail closed) — there is
  // no way to invoke it without deliberately configuring this. Never
  // NEXT_PUBLIC_, never logged.
  INTERNAL_TASK_SECRET: optional(z.string().min(16)),

  // ARCA (WSAA/WSFEv1) homologation certificate — Phase: ARCA Homologation
  // — Real WSAA + WSFEv1 Integration. FILE PATHS, never the raw PEM
  // content: a path can point at a local, gitignored file (see .gitignore's
  // *.pem/*.key/*.p12/*.pfx entries) without ever putting certificate/key
  // material in an env var value that could end up echoed in a shell
  // history, a process list, or a misconfigured logging integration. All
  // optional — see modules/fiscal-documents/arca/certificate-core.ts's
  // getArcaConnectionReadiness for how an absent value surfaces as a real,
  // specific readiness blocker, never a crash. Server-only: never
  // NEXT_PUBLIC_, never read from a Client Component. ARCA_PRIVATE_KEY_PASSPHRASE
  // is optional because a homologation key is commonly generated without one
  // — never assumed blank when actually set.
  ARCA_CERTIFICATE_PATH: optional(z.string().min(1)),
  ARCA_PRIVATE_KEY_PATH: optional(z.string().min(1)),
  ARCA_PRIVATE_KEY_PASSPHRASE: optional(z.string()),

  // E2E testing only — never set this in a real dev/production .env. Only
  // playwright.config.ts's webServer.env sets it to "true", which switches
  // modules/storage's getStorageProvider() to an in-memory, locally-served
  // provider instead of real Supabase Storage (see modules/storage/
  // e2e-provider.ts) — the e2e suite must never upload into the real
  // product-images bucket.
  E2E_TEST_MODE: z.preprocess((v) => v === "true", z.boolean()).default(false),

  // Email (dev: Mailpit; prod provider deferred, see INTEGRATIONS.md).
  // EMAIL_PROVIDER is forward-declared for a future "resend" value — only
  // "smtp" is implemented this phase (SmtpEmailProvider). SMTP_SECURE/USER/
  // PASSWORD are optional: Mailpit needs none of them (no TLS, no auth); a
  // real relay would set all three.
  EMAIL_PROVIDER: z.enum(["smtp"]).default("smtp"),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.preprocess((v) => v === "true", z.boolean()).default(false),
  SMTP_USER: optional(z.string().min(1)),
  SMTP_PASSWORD: optional(z.string().min(1)),
  EMAIL_FROM: z.email(),
  RESEND_API_KEY: optional(z.string().min(1)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment variables. See the error above and check .env.example.");
}

export const env = parsed.data;
