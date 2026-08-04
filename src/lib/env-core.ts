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

  // Initial admin — optional; the seed skips admin creation when absent.
  INITIAL_ADMIN_NAME: optional(z.string().min(1)),
  INITIAL_ADMIN_EMAIL: optional(z.email()),
  INITIAL_ADMIN_PASSWORD: optional(z.string().min(8)),

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
