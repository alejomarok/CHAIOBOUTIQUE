// @vitest-environment node
import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { databaseConnectionOptions } from "@/lib/database-connection";
import { SUPABASE_ROOT_CA } from "@/lib/supabase-ca";

describe("database TLS configuration", () => {
  it("verifies Supabase certificates without letting sslmode discard the CA", () => {
    const input =
      "postgresql://user:password@aws-1-us-west-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true";
    const options = databaseConnectionOptions(input);
    expect(new URL(options.connectionString!).searchParams.has("sslmode")).toBe(false);
    expect(new URL(options.connectionString!).searchParams.get("pgbouncer")).toBe("true");
    expect(options.ssl).toEqual({ ca: SUPABASE_ROOT_CA, rejectUnauthorized: true });
  });
  it("keeps local and other providers unchanged and respects an explicit root certificate", () => {
    for (const url of [
      "postgresql://user:password@localhost:56032/test",
      "postgresql://user:password@database.example.com/db?sslmode=verify-full",
      "postgresql://user:password@aws-1-us-west-2.pooler.supabase.com/db?sslrootcert=/cert.pem&sslmode=verify-full",
    ])
      expect(databaseConnectionOptions(url)).toEqual({ connectionString: url });
  });
  it("trusts the expected public CA, which is valid and self-signed", () => {
    const certificate = new X509Certificate(SUPABASE_ROOT_CA);
    expect(certificate.ca).toBe(true);
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.fingerprint256.replaceAll(":", "")).toBe(
      "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA",
    );
    expect(new Date(certificate.validTo).getTime()).toBeGreaterThan(Date.now());
  });
});
