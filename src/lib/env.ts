import "server-only";

import { z } from "zod";

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
  // own presence when actually instantiated.
  SUPABASE_URL: optional(z.url()),
  SUPABASE_SERVICE_ROLE_KEY: optional(z.string().min(1)),

  // Store
  STORE_NAME: z.string().min(1),
  STORE_CURRENCY: z.string().min(1),
  STORE_LOCALE: z.string().min(1),
  STORE_TIMEZONE: z.string().min(1),

  // Initial admin — optional; the seed skips admin creation when absent.
  INITIAL_ADMIN_NAME: optional(z.string().min(1)),
  INITIAL_ADMIN_EMAIL: optional(z.email()),
  INITIAL_ADMIN_PASSWORD: optional(z.string().min(8)),

  // Email (dev: Mailpit; prod provider deferred, see INTEGRATIONS.md)
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  EMAIL_FROM: z.email(),
  RESEND_API_KEY: optional(z.string().min(1)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment variables. See the error above and check .env.example.");
}

export const env = parsed.data;
