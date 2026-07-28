import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { StorageProvider, StoredObject, UploadInput } from "./provider";

function getClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }
  // Secret key (sb_secret_...): server-only, never sent to the browser. Used
  // because uploads target private-by-default buckets (see ARCHITECTURE.md).
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
}

export class SupabaseStorageProvider implements StorageProvider {
  async upload(input: UploadInput): Promise<StoredObject> {
    const client = getClient();
    const { error } = await client.storage.from(input.bucket).upload(input.path, input.file, {
      contentType: input.contentType,
      upsert: false,
    });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const size = input.file instanceof Blob ? input.file.size : input.file.byteLength;
    return { bucket: input.bucket, path: input.path, contentType: input.contentType, size };
  }

  async getSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string> {
    const client = getClient();
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data) {
      throw new Error(`Could not create signed URL: ${error?.message ?? "unknown error"}`);
    }

    return data.signedUrl;
  }

  // Synchronous, no network call — Supabase constructs public URLs client-side
  // from the project URL + bucket + path. Only meaningful for public buckets.
  getPublicUrl(bucket: string, path: string): string {
    const client = getClient();
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async delete(bucket: string, path: string): Promise<void> {
    const client = getClient();
    const { error } = await client.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}
