import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSupabaseDatabaseHost } from "../src/lib/database-connection";
import { SUPABASE_ROOT_CA } from "../src/lib/supabase-ca";

// Prisma's migration engine reads its root certificate from a file. Use a fresh
// private temporary directory; the file contains only the public certificate.
export function databaseCliUrl(value: string): string {
  const url = new URL(value);
  if (!isSupabaseDatabaseHost(url.hostname) || url.searchParams.has("sslrootcert")) return value;
  const directory = mkdtempSync(join(tmpdir(), "chaio-db-ca-"));
  const certificatePath = join(directory, "supabase-root-ca.crt");
  writeFileSync(certificatePath, SUPABASE_ROOT_CA, { mode: 0o600, flag: "wx" });
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set("sslrootcert", certificatePath);
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}
