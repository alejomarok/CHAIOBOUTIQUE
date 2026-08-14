import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { SignedUploadTarget, StorageProvider, StoredObject, UploadInput } from "./provider";

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

  // Uses the storage-js SDK's own createSignedUploadUrl, which — per
  // Supabase's own docs — returns a URL/token pair that authorizes writing
  // to that exact path "without further authentication": no anon/publishable
  // key needs to travel to the browser for the PUT that follows (verified
  // empirically against the real project during this change — a plain PUT
  // with no Authorization/apikey header succeeds). The secret key used to
  // *request* this token here never leaves the server.
  async createSignedUploadUrl(bucket: string, path: string): Promise<SignedUploadTarget> {
    const client = getClient();
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(`Could not create signed upload URL: ${error?.message ?? "unknown error"}`);
    }

    return { bucket, path: data.path, signedUrl: data.signedUrl, token: data.token };
  }

  async download(bucket: string, path: string): Promise<Buffer> {
    const client = getClient();
    const { data, error } = await client.storage.from(bucket).download(path);
    if (error || !data) {
      throw new Error(`Storage download failed: ${error?.message ?? "unknown error"}`);
    }
    return Buffer.from(await data.arrayBuffer());
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
