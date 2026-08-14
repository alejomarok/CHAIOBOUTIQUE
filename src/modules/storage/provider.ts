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

export interface SignedUploadTarget {
  bucket: string;
  path: string;
  // A short-lived (Supabase: 2h), path-scoped URL the browser can PUT the
  // file bytes to directly — no Supabase key of any kind travels to the
  // client. Never exposes anything a caller could reuse to write to a
  // *different* path.
  signedUrl: string;
  token: string;
}

// Only metadata (bucket, path, contentType, size) is ever meant to be
// persisted in Postgres — never binary content.
export interface StorageProvider {
  // Small/server-initiated uploads (the file bytes already exist
  // server-side). Product image upload no longer uses this path — see
  // createSignedUploadUrl below — but other entities may still upload
  // through the server directly (e.g. a future supplier-PDF import).
  upload(input: UploadInput): Promise<StoredObject>;
  // Direct-from-browser upload: the server never receives the file bytes.
  // The returned token authorizes writing to exactly this bucket/path and
  // nothing else — see modules/products/product-images.ts's
  // prepareProductImageUpload for how the path is always server-generated,
  // never client-supplied.
  createSignedUploadUrl(bucket: string, path: string): Promise<SignedUploadTarget>;
  // Reads an object's bytes back — used to verify the actual uploaded
  // content's file signature after a direct-from-browser upload, since the
  // server never saw the bytes in transit to validate them there. Objects
  // reaching this point are already small (client-side-optimized before
  // upload), so a full read is cheap.
  download(bucket: string, path: string): Promise<Buffer>;
  getSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  // Synchronous: only meaningful for objects in a public bucket (e.g.
  // published product images). Never use this for private buckets.
  getPublicUrl(bucket: string, path: string): string;
  delete(bucket: string, path: string): Promise<void>;
}
