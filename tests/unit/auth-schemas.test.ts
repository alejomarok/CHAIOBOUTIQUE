import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/modules/auth/schemas";

describe("loginSchema", () => {
  it("accepts a valid email and non-empty password", () => {
    const result = loginSchema.safeParse({ email: "admin@chaioboutique.com", password: "x" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "admin@chaioboutique.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("rejects a malformed email", () => {
    const result = forgotPasswordSchema.safeParse({ email: "nope" });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires at least 8 characters", () => {
    expect(resetPasswordSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "longenough" }).success).toBe(true);
  });
});

describe("registerSchema", () => {
  const validInput = {
    name: "Clienta Test",
    email: "clienta@test.chaioboutique.local",
    password: "password123",
    passwordConfirmation: "password123",
    termsAccepted: true,
    privacyAccepted: true,
    marketingConsent: false,
  };

  it("accepts a well-formed registration", () => {
    expect(registerSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects a password with no letter", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      password: "12345678",
      passwordConfirmation: "12345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no number", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      password: "passwordonly",
      passwordConfirmation: "passwordonly",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      password: "ab1",
      passwordConfirmation: "ab1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched password confirmation", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      passwordConfirmation: "somethingElse123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when termsAccepted is false", () => {
    const result = registerSchema.safeParse({ ...validInput, termsAccepted: false });
    expect(result.success).toBe(false);
  });

  it("rejects when privacyAccepted is false", () => {
    const result = registerSchema.safeParse({ ...validInput, privacyAccepted: false });
    expect(result.success).toBe(false);
  });

  it("does not require marketingConsent to be true", () => {
    expect(registerSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an unknown field — role/roleId/isAdmin can never sneak through", () => {
    const withExtraField = { ...validInput, role: "ADMIN" };
    const result = registerSchema.safeParse(withExtraField);
    expect(result.success).toBe(false);
  });

  it("rejects a client-submitted termsVersion — versions are server-controlled only", () => {
    const withVersion = { ...validInput, termsVersion: "2020-01-01" };
    expect(registerSchema.safeParse(withVersion).success).toBe(false);
  });
});
