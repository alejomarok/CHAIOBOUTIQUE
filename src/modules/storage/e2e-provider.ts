import "server-only";

import type { StorageProvider, StoredObject, UploadInput } from "./provider";

// In-memory only — objects live exactly as long as the Next.js process that
// holds them (the Playwright webServer instance for one `npm run test:e2e`
// run) and vanish the moment it exits. Selected only when env.E2E_TEST_MODE
// is true (see getStorageProvider in ./index.ts) — the real
// SupabaseStorageProvider stays the default for every other context, so
// this file changes no production behavior and never touches the real
// product-images bucket or needs SUPABASE_SECRET_KEY. Served back over HTTP
// by src/app/api/e2e-storage/[bucket]/[...path]/route.ts, which reads from
// this exact same module-level store — `next dev` is one long-lived Node
// process for the whole e2e run, so the singleton Map is shared correctly
// between whatever uploaded and whatever later requests the image.
const store = new Map<string, { buffer: Buffer; contentType: string }>();

function keyFor(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

export class E2EStorageProvider implements StorageProvider {
  async upload(input: UploadInput): Promise<StoredObject> {
    const buffer = Buffer.isBuffer(input.file)
      ? input.file
      : Buffer.from(await input.file.arrayBuffer());
    store.set(keyFor(input.bucket, input.path), { buffer, contentType: input.contentType });
    return {
      bucket: input.bucket,
      path: input.path,
      contentType: input.contentType,
      size: buffer.byteLength,
    };
  }

  // No real distinction between "signed" and "public" here — both just
  // point at the same locally-served route; there is no private-bucket
  // concept to model in-memory.
  async getSignedUrl(bucket: string, path: string): Promise<string> {
    return this.getPublicUrl(bucket, path);
  }

  getPublicUrl(bucket: string, path: string): string {
    return `/api/e2e-storage/${bucket}/${path}`;
  }

  async delete(bucket: string, path: string): Promise<void> {
    store.delete(keyFor(bucket, path));
  }
}

// The read side for the API route — deliberately the only other consumer of
// `store`, so this module's in-memory state is only ever touched from these
// two places.
export function readE2EStorageObject(
  bucket: string,
  path: string,
): { buffer: Buffer; contentType: string } | undefined {
  return store.get(keyFor(bucket, path));
}
