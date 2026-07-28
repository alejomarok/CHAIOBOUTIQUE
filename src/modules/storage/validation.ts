export class StorageValidationError extends Error {}

const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const EXTENSIONS_BY_MIME_TYPE: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

export interface ValidateUploadInput {
  filename: string;
  contentType: string;
  size: number;
  allowedMimeTypes: string[];
  maxSizeBytes?: number;
}

// MIME allowlist + extension cross-check + size bound. Callers pass their
// own allowedMimeTypes (e.g. product images vs. supplier PDFs) rather than a
// single global list.
export function validateUpload(input: ValidateUploadInput): void {
  const maxSize = input.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

  if (!input.allowedMimeTypes.includes(input.contentType)) {
    throw new StorageValidationError(`Content type not allowed: ${input.contentType}`);
  }

  if (input.size <= 0 || input.size > maxSize) {
    throw new StorageValidationError(`File size out of range: ${input.size} bytes`);
  }

  const extension = input.filename.split(".").pop()?.toLowerCase();
  const allowedExtensions = EXTENSIONS_BY_MIME_TYPE[input.contentType];

  if (!extension || !allowedExtensions?.includes(extension)) {
    throw new StorageValidationError(
      `File extension "${extension ?? ""}" does not match content type "${input.contentType}"`,
    );
  }
}

// File-signature ("magic bytes") check — validates the actual bytes, not
// just the declared Content-Type header, which a caller could lie about.
// Deliberately dependency-free: reads a handful of leading bytes rather than
// decoding the whole image (no sharp/native dependency needed for this).
const MIME_TYPE_BY_SIGNATURE: Array<{
  contentType: string;
  matches: (bytes: Uint8Array) => boolean;
}> = [
  { contentType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    contentType: "image/png",
    matches: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d,
  },
  {
    contentType: "image/webp",
    matches: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

export function detectImageContentType(bytes: Uint8Array): string | null {
  return MIME_TYPE_BY_SIGNATURE.find((entry) => entry.matches(bytes))?.contentType ?? null;
}

export function validateImageFileSignature(bytes: Uint8Array, declaredContentType: string): void {
  const detected = detectImageContentType(bytes);
  if (detected === null) {
    throw new StorageValidationError("El archivo no parece ser una imagen válida.");
  }
  if (detected !== declaredContentType) {
    throw new StorageValidationError(
      `El contenido del archivo no coincide con el tipo declarado ("${declaredContentType}").`,
    );
  }
}

// Prevents path traversal / writing into another entity's folder: the
// resolved path always stays within entityType/entityId/ and uses a
// generated filename, never whatever the caller/browser supplied.
export function buildObjectPath(entityType: string, entityId: string, extension: string): string {
  const safeEntityType = entityType.replace(/[^a-z0-9-]/gi, "");
  const safeEntityId = entityId.replace(/[^a-z0-9-]/gi, "");
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "");

  if (!safeEntityType || !safeEntityId || !safeExtension) {
    throw new StorageValidationError(
      "Invalid entity type, entity id, or extension for a storage path",
    );
  }

  const uniqueSegment = crypto.randomUUID();
  return `${safeEntityType}/${safeEntityId}/${uniqueSegment}.${safeExtension}`;
}
