// Read-only source operation. Run on a trusted backup host with pg_dump installed.
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  if (!process.env.BACKUP_DIRECTORY || !isAbsolute(process.env.BACKUP_DIRECTORY))
    throw new Error("Set an absolute private BACKUP_DIRECTORY outside the repository.");
  const parent = resolve(process.env.BACKUP_DIRECTORY);
  const workspace = resolve(process.cwd());
  const comparable = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  if (
    comparable(parent) === comparable(workspace) ||
    comparable(parent).startsWith(comparable(workspace + sep))
  )
    throw new Error("Backups must be stored outside the repository and web root.");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    throw new Error("Storage credentials are required for a complete backup.");
  const db = new URL(process.env.DIRECT_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(db.protocol))
    throw new Error("DIRECT_URL must identify PostgreSQL.");
  const root = join(parent, `chaio-${new Date().toISOString().replaceAll(":", "-")}`);
  await mkdir(parent, { recursive: true });
  const realParent = comparable(await realpath(parent));
  const realWorkspace = comparable(await realpath(workspace));
  if (realParent === realWorkspace || realParent.startsWith(realWorkspace + sep))
    throw new Error("Backup destination resolves inside the repository.");
  await mkdir(root, { mode: 0o700 });
  const incomplete = join(root, "INCOMPLETE");
  await writeFile(
    incomplete,
    "Do not restore until manifest.json exists and every object checksum is verified.",
    { mode: 0o600 },
  );
  // Credentials go through child environment, never command-line arguments or logs.
  await new Promise((accept, reject) => {
    const child = spawn(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", "--file", join(root, "database.dump")],
      {
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PGHOST: db.hostname,
          PGPORT: db.port || "5432",
          PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
          PGUSER: decodeURIComponent(db.username),
          PGPASSWORD: decodeURIComponent(db.password),
          PGSSLMODE: ["localhost", "127.0.0.1"].includes(db.hostname) ? "disable" : "require",
        },
      },
    );
    child.once("error", () =>
      reject(new Error("pg_dump could not start. Install PostgreSQL client tools.")),
    );
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error("Database backup failed. Verify access and pg_dump compatibility.")),
    );
  });
  const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  }).storage;
  const bucket = process.env.SUPABASE_PRODUCT_IMAGES_BUCKET || "product-images";
  const entries = [];
  async function visit(prefix) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage
        .from(bucket)
        .list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !data) throw new Error("Could not list storage objects.");
      for (const item of data) {
        if (!item.name || /[\\/:]/.test(item.name) || [".", ".."].includes(item.name))
          throw new Error("Unsafe storage object name.");
        const name = prefix ? `${prefix}/${item.name}` : item.name;
        if (!item.id) {
          await visit(name);
          continue;
        }
        const target = resolve(root, "storage", ...name.split("/"));
        const storageRoot = resolve(root, "storage") + sep;
        if (!target.startsWith(storageRoot)) throw new Error("Unsafe backup destination.");
        const { data: blob, error: downloadError } = await storage.from(bucket).download(name);
        if (downloadError || !blob) throw new Error("Could not download a storage object.");
        const bytes = Buffer.from(await blob.arrayBuffer());
        await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
        entries.push({
          name,
          bytes: bytes.length,
          contentType: blob.type,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      if (data.length < 100) break;
    }
  }
  await visit("");
  const databaseHash = createHash("sha256");
  for await (const chunk of createReadStream(join(root, "database.dump")))
    databaseHash.update(chunk);
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        databaseSha256: databaseHash.digest("hex"),
        bucket,
        entries,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await rm(incomplete);
  console.log(
    `Backup complete: database and ${entries.length} storage objects. Store encrypted off-site and test restoration. Encryption keys are excluded.`,
  );
}
main().catch(() => {
  console.error(
    "Backup incomplete. Inspect access/client configuration; preserve the INCOMPLETE marker and do not restore this snapshot.",
  );
  process.exitCode = 1;
});
