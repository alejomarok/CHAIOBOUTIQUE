import { describe, expect, it } from "vitest";

import {
  detectImageContentType,
  StorageValidationError,
  validateImageFileSignature,
} from "@/modules/storage/validation";

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const NOT_AN_IMAGE = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

describe("detectImageContentType", () => {
  it("detects JPEG from magic bytes", () => {
    expect(detectImageContentType(JPEG_HEADER)).toBe("image/jpeg");
  });

  it("detects PNG from magic bytes", () => {
    expect(detectImageContentType(PNG_HEADER)).toBe("image/png");
  });

  it("detects WebP from magic bytes", () => {
    expect(detectImageContentType(WEBP_HEADER)).toBe("image/webp");
  });

  it("returns null for non-image bytes", () => {
    expect(detectImageContentType(NOT_AN_IMAGE)).toBeNull();
  });
});

describe("validateImageFileSignature", () => {
  it("accepts bytes matching the declared content type", () => {
    expect(() => validateImageFileSignature(JPEG_HEADER, "image/jpeg")).not.toThrow();
  });

  it("rejects a declared type that doesn't match the actual bytes (spoofing)", () => {
    expect(() => validateImageFileSignature(PNG_HEADER, "image/jpeg")).toThrow(
      StorageValidationError,
    );
  });

  it("rejects bytes that aren't a recognized image format at all", () => {
    expect(() => validateImageFileSignature(NOT_AN_IMAGE, "image/jpeg")).toThrow(
      StorageValidationError,
    );
  });
});
