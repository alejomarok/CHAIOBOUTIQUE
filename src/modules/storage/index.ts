import "server-only";

import type { StorageProvider } from "./provider";
import { SupabaseStorageProvider } from "./supabase-provider";

export type { StorageProvider, UploadInput, StoredObject } from "./provider";
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
    provider = new SupabaseStorageProvider();
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
