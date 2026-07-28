export interface UploadInput {
  bucket: string;
  path: string;
  file: Buffer | Blob;
  contentType: string;
}

export interface StoredObject {
  bucket: string;
  path: string;
  contentType: string;
  size: number;
}

// Only metadata (bucket, path, contentType, size) is ever meant to be
// persisted in Postgres — never binary content.
export interface StorageProvider {
  upload(input: UploadInput): Promise<StoredObject>;
  getSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  // Synchronous: only meaningful for objects in a public bucket (e.g.
  // published product images). Never use this for private buckets.
  getPublicUrl(bucket: string, path: string): string;
  delete(bucket: string, path: string): Promise<void>;
}
