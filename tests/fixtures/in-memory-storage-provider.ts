import type { SignedUploadTarget, StorageProvider, StoredObject, UploadInput } from "@/modules/storage";

// A genuine, functioning implementation of the real StorageProvider
// interface — not a mock of internal calls — so integration tests exercise
// real validation/DB-persistence logic end-to-end and only substitute the
// actual network call to Supabase. See modules/storage/index.ts's
// setStorageProviderForTesting.
export class InMemoryStorageProvider implements StorageProvider {
  private objects = new Map<string, Buffer>();
  private pendingUploadTokens = new Map<string, string>();

  async upload(input: UploadInput): Promise<StoredObject> {
    const key = `${input.bucket}/${input.path}`;
    const file = input.file;
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(await file.arrayBuffer());
    this.objects.set(key, buffer);
    return {
      bucket: input.bucket,
      path: input.path,
      contentType: input.contentType,
      size: buffer.byteLength,
    };
  }

  // Integration tests have no real browser to PUT to a signedUrl, so they
  // simulate that step by calling upload() directly with the token's
  // matching bucket/path once this has been called — the same two-phase
  // shape modules/products/product-images.ts's prepare/finalize functions
  // expect, just driven by test code instead of ProductImagesManager.
  async createSignedUploadUrl(bucket: string, path: string): Promise<SignedUploadTarget> {
    const token = `memory-token-${crypto.randomUUID()}`;
    this.pendingUploadTokens.set(`${bucket}/${path}`, token);
    return { bucket, path, signedUrl: `memory://${bucket}/${path}?upload=1&token=${token}`, token };
  }

  async download(bucket: string, path: string): Promise<Buffer> {
    const buffer = this.objects.get(`${bucket}/${path}`);
    if (!buffer) throw new Error(`InMemoryStorageProvider: object not found: ${bucket}/${path}`);
    return buffer;
  }

  async getSignedUrl(bucket: string, path: string): Promise<string> {
    return `memory://${bucket}/${path}?signed=1`;
  }

  getPublicUrl(bucket: string, path: string): string {
    return `memory://${bucket}/${path}`;
  }

  async delete(bucket: string, path: string): Promise<void> {
    this.objects.delete(`${bucket}/${path}`);
  }

  has(bucket: string, path: string): boolean {
    return this.objects.has(`${bucket}/${path}`);
  }
}
