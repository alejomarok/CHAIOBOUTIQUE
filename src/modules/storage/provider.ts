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
// persisted in Postgres — never binary content. No UI wires an upload yet in
// this phase (see ARCHITECTURE.md) but the abstraction + validation is real
// and unit-tested so a future module can build on it directly.
export interface StorageProvider {
  upload(input: UploadInput): Promise<StoredObject>;
  getSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  delete(bucket: string, path: string): Promise<void>;
}
