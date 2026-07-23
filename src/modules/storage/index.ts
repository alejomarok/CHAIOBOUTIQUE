import "server-only";

import type { StorageProvider } from "./provider";
import { SupabaseStorageProvider } from "./supabase-provider";

export type { StorageProvider, UploadInput, StoredObject } from "./provider";
export { StorageValidationError, validateUpload, buildObjectPath } from "./validation";

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!provider) {
    provider = new SupabaseStorageProvider();
  }
  return provider;
}
