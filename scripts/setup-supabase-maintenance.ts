import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { databaseConnectionOptions } from "../src/lib/database-connection";

const args = process.argv.slice(2);
const argument = (name: string) => args[args.indexOf(name) + 1];

async function main() {
  const connection = new URL(process.env.DIRECT_URL ?? "");
  const app = new URL(argument("--app-url") || process.env.NEXT_PUBLIC_APP_URL || "");
  if (
    !args.includes("--app-url") ||
    app.protocol !== "https:" ||
    app.username ||
    app.password ||
    app.pathname !== "/"
  )
    throw new Error("Provide the exact HTTPS production origin with --app-url.");
  const project = new URL(process.env.SUPABASE_URL ?? "").hostname.split(".")[0];
  if (
    !connection.hostname.endsWith(".pooler.supabase.com") ||
    !decodeURIComponent(connection.username).endsWith(`.${project}`)
  )
    throw new Error("DIRECT_URL must use this Supabase project's session pooler.");
  const source = args.includes("--secret-file")
    ? JSON.parse(readFileSync(argument("--secret-file"), "utf8"))
    : process.env;
  const secret = source.CRON_SECRET || source.INTERNAL_TASK_SECRET;
  if (!secret || secret.length < 16)
    throw new Error("A maintenance secret is required. Never pass it on the command line.");
  const client = new Client({
    ...databaseConnectionOptions(connection.toString()),
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_cron");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions");
    for (const [name, value] of [
      ["chaio_maintenance_token", secret],
      ["chaio_maintenance_url", `${app.origin}/api/internal/expire-stale-orders`],
    ]) {
      const existing = await client.query("SELECT id FROM vault.secrets WHERE name = $1", [name]);
      if (existing.rows[0])
        await client.query("SELECT vault.update_secret($1::uuid, $2, $3)", [
          existing.rows[0].id,
          value,
          name,
        ]);
      else
        await client.query("SELECT vault.create_secret($1, $2, $3)", [
          value,
          name,
          "CHAIOBOUTIQUE production maintenance",
        ]);
    }
    const command = `SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'chaio_maintenance_url'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'chaio_maintenance_token')),
      body := '{}'::jsonb, timeout_milliseconds := 55000
    );`;
    const result = await client.query("SELECT cron.schedule($1, $2, $3) AS job_id", [
      "chaioboutique-maintenance",
      "*/5 * * * *",
      command,
    ]);
    const jobId = result.rows[0].job_id;
    await client.query("SELECT cron.alter_job($1::bigint, active := $2::boolean)", [
      jobId,
      args.includes("--activate"),
    ]);
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        jobId,
        schedule: "every five minutes",
        active: args.includes("--activate"),
        appHost: app.hostname,
        secretStoredInVault: true,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    const failure = error as { code?: string; message?: string };
    throw new Error(
      `Supabase maintenance setup failed (${failure.code ?? "unknown"}): ${String(failure.message ?? "database error").replaceAll(secret, "<redacted>")}`,
    );
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
