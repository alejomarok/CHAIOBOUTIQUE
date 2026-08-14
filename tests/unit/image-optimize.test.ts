import { describe, expect, it } from "vitest";

import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_SOURCE_FILE_SIZE_BYTES,
  validateSelectedImageFile,
} from "@/lib/image-optimize";

function fileOfSize(size: number, type: string): File {
  return new File([new Uint8Array(size)], "photo.jpg", { type });
}

describe("validateSelectedImageFile", () => {
  it("accepts every allowed MIME type within the size limit", () => {
    for (const type of ALLOWED_IMAGE_MIME_TYPES) {
      expect(validateSelectedImageFile(fileOfSize(1024, type))).toBeNull();
    }
  });

  it("rejects a disallowed MIME type with a Spanish message", () => {
    const error = validateSelectedImageFile(fileOfSize(1024, "application/pdf"));
    expect(error).toMatch(/Formato no permitido/);
  });

  it("rejects a file over the source size ceiling with a Spanish message", () => {
    const error = validateSelectedImageFile(fileOfSize(MAX_SOURCE_FILE_SIZE_BYTES + 1, "image/jpeg"));
    expect(error).toMatch(/demasiado pesada/);
  });

  it("accepts a file exactly at the source size ceiling", () => {
    expect(validateSelectedImageFile(fileOfSize(MAX_SOURCE_FILE_SIZE_BYTES, "image/jpeg"))).toBeNull();
  });
});
