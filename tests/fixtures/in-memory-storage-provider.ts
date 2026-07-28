import type { StorageProvider, StoredObject, UploadInput } from "@/modules/storage";

// A genuine, functioning implementation of the real StorageProvider
// interface — not a mock of internal calls — so integration tests exercise
// real validation/DB-persistence logic end-to-end and only substitute the
// actual network call to Supabase. See modules/storage/index.ts's
// setStorageProviderForTesting.
export class InMemoryStorageProvider implements StorageProvider {
  private objects = new Map<string, Buffer>();

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
