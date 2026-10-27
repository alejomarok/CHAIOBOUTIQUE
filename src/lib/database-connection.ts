import type { PoolConfig } from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

export function isSupabaseDatabaseHost(host: string) {
  return host.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9]+\.supabase\.co$/.test(host);
}

export function databaseConnectionOptions(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  if (!isSupabaseDatabaseHost(url.hostname)) return { connectionString };
  // pg lets URL sslmode replace the SSL object, discarding its trusted CA.
  // Keep certificate and hostname verification enabled for Supabase's private CA.
  if (url.searchParams.has("sslrootcert")) return { connectionString };
  for (const parameter of ["sslmode", "ssl", "uselibpqcompat"]) url.searchParams.delete(parameter);
  return {
    connectionString: url.toString(),
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
  };
}
