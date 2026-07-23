import { describe, expect, it } from "vitest";

import {
  buildObjectPath,
  StorageValidationError,
  validateUpload,
} from "@/modules/storage/validation";

describe("validateUpload", () => {
  const allowedMimeTypes = ["image/jpeg", "image/png"];

  it("accepts a well-formed image upload", () => {
    expect(() =>
      validateUpload({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        size: 1024,
        allowedMimeTypes,
      }),
    ).not.toThrow();
  });

  it("rejects a content type outside the allowlist", () => {
    expect(() =>
      validateUpload({
        filename: "document.pdf",
        contentType: "application/pdf",
        size: 1024,
        allowedMimeTypes,
      }),
    ).toThrow(StorageValidationError);
  });

  it("rejects a file over the size limit", () => {
    expect(() =>
      validateUpload({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        size: 10 * 1024 * 1024,
        allowedMimeTypes,
        maxSizeBytes: 5 * 1024 * 1024,
      }),
    ).toThrow(StorageValidationError);
  });

  it("rejects a zero or negative size", () => {
    expect(() =>
      validateUpload({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        size: 0,
        allowedMimeTypes,
      }),
    ).toThrow(StorageValidationError);
  });

  it("rejects a filename extension that doesn't match the declared content type", () => {
    expect(() =>
      validateUpload({
        filename: "malicious.exe",
        contentType: "image/jpeg",
        size: 1024,
        allowedMimeTypes,
      }),
    ).toThrow(StorageValidationError);
  });

  it("rejects a spoofed extension (image/png claimed, .jpg filename)", () => {
    expect(() =>
      validateUpload({
        filename: "photo.jpg",
        contentType: "image/png",
        size: 1024,
        allowedMimeTypes,
      }),
    ).toThrow(StorageValidationError);
  });
});

describe("buildObjectPath", () => {
  it("builds a path scoped to entityType/entityId with a generated filename", () => {
    const path = buildObjectPath("products", "abc123", "jpg");
    expect(path).toMatch(/^products\/abc123\/[0-9a-f-]+\.jpg$/);
  });

  it("strips path traversal attempts out of entityType/entityId", () => {
    const path = buildObjectPath("../../etc", "passwd", "jpg");
    expect(path).not.toContain("..");
    expect(path).not.toContain("/etc");
  });

  it("rejects an entity id that sanitizes down to empty", () => {
    expect(() => buildObjectPath("products", "///", "jpg")).toThrow(StorageValidationError);
  });

  it("never produces the same path twice for the same inputs", () => {
    const first = buildObjectPath("products", "abc123", "jpg");
    const second = buildObjectPath("products", "abc123", "jpg");
    expect(first).not.toBe(second);
  });
});
