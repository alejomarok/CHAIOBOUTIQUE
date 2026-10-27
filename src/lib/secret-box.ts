import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/lib/env-core";

function key(purpose: string) {
  const master = env.DATA_ENCRYPTION_KEY
    ? Buffer.from(env.DATA_ENCRYPTION_KEY, "hex")
    : env.BETTER_AUTH_SECRET;
  return Buffer.from(hkdfSync("sha256", master, "chaioboutique:v1", purpose, 32));
}

// Purpose-bound authenticated encryption for queued emails and recoverable order links.
export function sealSecret(value: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

export function openSecret(value: string, purpose: string): string {
  const [version, iv, tag, body, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra || value.length > 100_000)
    throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
