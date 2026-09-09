// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { getStoreConfiguration, updateStoreConfiguration } from "@/modules/store-settings/service-core";

const STORE_CONFIGURATION_ID = "main";

// Phase — Fix `npm run build`: getStoreConfiguration() used to be
// prisma.storeConfiguration.upsert(...), meaning a function named "get"
// wrote to the database on every call — including `next build`'s own
// static-generation probe of /cart and every other public route. This
// proves the corrected, read-only contract directly against the real
// database: a missing row is never created by a read, only by an explicit
// admin mutation (updateStoreConfiguration).
describe("getStoreConfiguration is read-only (real DB)", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
    // Guarantee the shared singleton row exists again afterward, no matter
    // what an individual test below did to it — every other integration
    // test file in this shared-database suite assumes
    // StoreConfiguration.id="main" already exists (fileParallelism:false
    // in vitest.integration.config.ts means files never race on this, but
    // a later test in THIS file, or a later file, must still find it).
    const existing = await prisma.storeConfiguration.findUnique({ where: { id: STORE_CONFIGURATION_ID } });
    if (!existing) {
      await prisma.storeConfiguration.create({
        data: {
          id: STORE_CONFIGURATION_ID,
          name: env.STORE_NAME,
          currency: env.STORE_CURRENCY,
          locale: env.STORE_LOCALE,
          timezone: env.STORE_TIMEZONE,
        },
      });
    }
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "Store Config Actor",
      email: `store-config-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("a single call never creates the row when it's missing", async () => {
    await prisma.storeConfiguration.delete({ where: { id: STORE_CONFIGURATION_ID } }).catch(() => {});
    expect(await prisma.storeConfiguration.findUnique({ where: { id: STORE_CONFIGURATION_ID } })).toBeNull();

    const config = await getStoreConfiguration();

    // Still returns something usable (the non-persisted default, derived
    // from STORE_* env vars) — cart/checkout/footer/fiscal code must keep
    // working even before the row exists.
    expect(config.name).toBe(env.STORE_NAME);
    expect(config.currency).toBe(env.STORE_CURRENCY);
    expect(config.id).toBe(STORE_CONFIGURATION_ID);

    // The actual, load-bearing assertion: still no row in the database.
    expect(await prisma.storeConfiguration.findUnique({ where: { id: STORE_CONFIGURATION_ID } })).toBeNull();
  });

  it("repeated calls while the row is missing never create it either", async () => {
    await prisma.storeConfiguration.delete({ where: { id: STORE_CONFIGURATION_ID } }).catch(() => {});

    await getStoreConfiguration();
    await getStoreConfiguration();
    await getStoreConfiguration();

    expect(await prisma.storeConfiguration.findUnique({ where: { id: STORE_CONFIGURATION_ID } })).toBeNull();
  });

  it("reads back the real row unmodified when it does exist", async () => {
    await prisma.storeConfiguration.update({ where: { id: STORE_CONFIGURATION_ID }, data: { name: "CHAIOBOUTIQUE" } });

    const before = await prisma.storeConfiguration.findUniqueOrThrow({ where: { id: STORE_CONFIGURATION_ID } });
    const config = await getStoreConfiguration();

    expect(config.id).toBe(before.id);
    expect(config.name).toBe(before.name);
    expect(config.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    // updatedAt must not have moved — a genuine read never touches the row.
    const after = await prisma.storeConfiguration.findUniqueOrThrow({ where: { id: STORE_CONFIGURATION_ID } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("updateStoreConfiguration — not getStoreConfiguration — is what may create the row", async () => {
    await prisma.storeConfiguration.delete({ where: { id: STORE_CONFIGURATION_ID } }).catch(() => {});
    const actor = await makeActor();

    await updateStoreConfiguration({ publicPhone: "03571 999999" }, actor.id);

    const row = await prisma.storeConfiguration.findUniqueOrThrow({ where: { id: STORE_CONFIGURATION_ID } });
    expect(row.publicPhone).toBe("03571 999999");
    // The 4 required fields still get real values (from STORE_* env
    // defaults, same as prisma/seed.ts would use), never left blank.
    expect(row.name).toBe(env.STORE_NAME);
    expect(row.currency).toBe(env.STORE_CURRENCY);
  });
});
