import "server-only";

import type { SignedUploadTarget, StorageProvider, StoredObject, UploadInput } from "./provider";

// In-memory only — objects live exactly as long as the Next.js process that
// holds them (the Playwright webServer instance for one `npm run test:e2e`
// run) and vanish the moment it exits. Selected only when env.E2E_TEST_MODE
// is true (see getStorageProvider in ./index.ts) — the real
// SupabaseStorageProvider stays the default for every other context, so
// this file changes no production behavior and never touches the real
// product-images bucket or needs SUPABASE_SECRET_KEY. Served back over HTTP
// by src/app/api/e2e-storage/[bucket]/[...path]/route.ts.
//
// Backed by globalThis, not a plain module-level const — same reasoning as
// src/lib/db-core.ts's Prisma singleton. Next.js/Turbopack compiles Server
// Actions and Route Handlers into separate module "layers"; a plain
// module-level Map can end up as two independent instances (one per layer)
// even though both files import "the same" module, which silently broke the
// prepare (Server Action) → PUT (Route Handler) handshake — the token minted
// by createSignedUploadUrl was never visible to the PUT handler's
// writeE2EStorageObject, so every upload was rejected with 403. globalThis
// is the one object guaranteed to be the same across layers within a single
// Node process.
const globalForE2EStorage = globalThis as unknown as {
  __e2eStorageStore: Map<string, { buffer: Buffer; contentType: string }> | undefined;
  __e2eStoragePendingTokens: Map<string, string> | undefined;
};

const store = (globalForE2EStorage.__e2eStorageStore ??= new Map());

// Mirrors Supabase's real signed-upload-token model closely enough for e2e
// coverage: a token is minted for one exact bucket/path pair and consumed
// (deleted) the first time it's used to PUT — see the API route's PUT
// handler. Never persisted beyond process lifetime, same as `store`.
const pendingUploadTokens = (globalForE2EStorage.__e2eStoragePendingTokens ??= new Map());

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

  // The e2e equivalent of Supabase's real signed-upload flow: a token
  // scoped to this exact bucket/path, redeemable exactly once via a PUT to
  // the locally-served route below — same shape the browser talks to in
  // production (a signedUrl + token, no secret key), so
  // ProductImagesManager's upload code path is identical in both.
  async createSignedUploadUrl(bucket: string, path: string): Promise<SignedUploadTarget> {
    const token = crypto.randomUUID();
    pendingUploadTokens.set(keyFor(bucket, path), token);
    return {
      bucket,
      path,
      signedUrl: `/api/e2e-storage/${bucket}/${path}?token=${token}`,
      token,
    };
  }

  async download(bucket: string, path: string): Promise<Buffer> {
    const object = store.get(keyFor(bucket, path));
    if (!object) throw new Error(`E2E storage object not found: ${bucket}/${path}`);
    return object.buffer;
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

// The write side for the API route's PUT handler — validates the supplied
// token against the one minted for this exact bucket/path by
// createSignedUploadUrl, then consumes it (single-use, matching real signed
// upload tokens). Returns false (write refused) on any mismatch/replay.
export function writeE2EStorageObject(
  bucket: string,
  path: string,
  token: string,
  buffer: Buffer,
  contentType: string,
): boolean {
  const key = keyFor(bucket, path);
  const expectedToken = pendingUploadTokens.get(key);
  if (!expectedToken || expectedToken !== token) return false;

  pendingUploadTokens.delete(key);
  store.set(key, { buffer, contentType });
  return true;
}
