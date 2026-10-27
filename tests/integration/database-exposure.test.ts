import "./guard";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db-core";
import { APPLICATION_TABLE_NAMES } from "@/lib/application-tables";
import { assertSafeToResetTestDatabase } from "./reset-db";

describe("business data cannot bypass the application through Supabase roles", () => {
  it("enables RLS on every mapped application table", async () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const names = [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]);
    expect([...APPLICATION_TABLE_NAMES].sort()).toEqual([...names, "_prisma_migrations"].sort());
    const rows = await prisma.$queryRaw<
      Array<{ tablename: string; rowsecurity: boolean }>
    >`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`;
    for (const name of names)
      expect(rows.find((row) => row.tablename === name)?.rowsecurity, name).toBe(true);
  });
  it("hides all rows and prevents insert/update/delete even if an unprivileged role receives accidental grants", async () => {
    assertSafeToResetTestDatabase();
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    const role = `rls_probe_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_configuration TO ${role}`,
      );
      await client.query(`SET LOCAL ROLE ${role}`);
      expect((await client.query("SELECT * FROM public.store_configuration")).rows).toHaveLength(0);
      expect(
        (
          await client.query(
            "UPDATE public.store_configuration SET name = 'blocked' WHERE id = 'main'",
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await client.query("DELETE FROM public.store_configuration WHERE id = 'main'")).rowCount,
      ).toBe(0);
      await client.query("SAVEPOINT denied_insert");
      await expect(
        client.query(
          "INSERT INTO public.store_configuration (id, name, currency, locale, timezone, \"updatedAt\") VALUES ('forbidden', 'Probe', 'ARS', 'es-AR', 'UTC', NOW())",
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT denied_insert");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
  it("revokes Data API table privileges for anon and authenticated roles", async () => {
    assertSafeToResetTestDatabase();
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      for (const role of ["anon", "authenticated"]) {
        if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount)
          await client.query(`CREATE ROLE ${role} NOLOGIN`);
        await client.query(`GRANT ALL PRIVILEGES ON public.customer TO ${role}`);
      }
      await client.query(
        readFileSync(
          "prisma/migrations/20261023170000_restrict_direct_data_access/migration.sql",
          "utf8",
        ),
      );
      for (const role of ["anon", "authenticated"]) {
        const result = await client.query(
          "SELECT has_table_privilege($1, 'public.customer', 'SELECT') AS can_read, has_table_privilege($1, 'public.customer', 'INSERT') AS can_write, has_table_privilege($1, 'public.customer', 'TRUNCATE') AS can_truncate",
          [role],
        );
        expect(result.rows[0]).toEqual({ can_read: false, can_write: false, can_truncate: false });
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
