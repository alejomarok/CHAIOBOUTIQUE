import "server-only";

import { env } from "@/lib/env";

import type { StorageProvider } from "./provider";
import { E2EStorageProvider } from "./e2e-provider";
import { SupabaseStorageProvider } from "./supabase-provider";

export type { StorageProvider, UploadInput, StoredObject, SignedUploadTarget } from "./provider";
export {
  StorageValidationError,
  buildObjectPath,
  detectImageContentType,
  validateImageFileSignature,
  validateUpload,
} from "./validation";

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!provider) {
    // env.E2E_TEST_MODE is validated, server-only config (env-core.ts) —
    // only ever set to "true" by playwright.config.ts's webServer.env, never
    // in a real dev/production .env. This is the one place storage
    // selection happens; choosing it here (not in app code that calls
    // uploadProductImage) keeps the real product-images Supabase bucket
    // completely untouched by the e2e suite.
    provider = env.E2E_TEST_MODE ? new E2EStorageProvider() : new SupabaseStorageProvider();
  }
  return provider;
}

// Test-only: lets integration tests inject a fake StorageProvider (a real,
// functioning implementation of the interface, not a mock of internal
// calls) instead of hitting real Supabase Storage, which isn't part of the
// Postgres-only TEST_DATABASE_URL environment. Never called from
// application code.
export function setStorageProviderForTesting(testProvider: StorageProvider | null): void {
  provider = testProvider;
}
