// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import {
  BranchNotFoundError,
  listActiveBranches,
  listBranches,
  updateBranch,
} from "@/modules/store-branches/branch-core";
import { seedStoreBranches } from "@/modules/store-branches/seed-core";
import {
  getStoreConfiguration,
  updateStoreConfiguration,
} from "@/modules/store-settings/service-core";

describe("store settings — contact/social fields (Phase: Public Footer Redesign, real DB)", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
    // Reset the shared single-row config's new fields to null so later
    // tests (and other files reading StoreConfiguration) never see
    // leftover values from this file's own writes.
    await prisma.storeConfiguration.update({
      where: { id: "main" },
      data: {
        publicPhone: null,
        whatsappPhone: null,
        publicEmail: null,
        instagramUrl: null,
        facebookUrl: null,
        tiktokUrl: null,
      },
    });
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "Settings Actor",
      email: `settings-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("persists and reads back contact and social fields", async () => {
    const actor = await makeActor();
    await updateStoreConfiguration(
      {
        publicPhone: "03571 123456",
        whatsappPhone: "+5493571123456",
        publicEmail: "hola@chaioboutique.local",
        instagramUrl: "https://instagram.com/chaioboutique",
        facebookUrl: "https://facebook.com/chaioboutique",
        tiktokUrl: "https://tiktok.com/@chaioboutique",
      },
      actor.id,
    );

    const config = await getStoreConfiguration();
    expect(config.publicPhone).toBe("03571 123456");
    expect(config.whatsappPhone).toBe("+5493571123456");
    expect(config.publicEmail).toBe("hola@chaioboutique.local");
    expect(config.instagramUrl).toBe("https://instagram.com/chaioboutique");
    expect(config.facebookUrl).toBe("https://facebook.com/chaioboutique");
    expect(config.tiktokUrl).toBe("https://tiktok.com/@chaioboutique");
  });

  it("a true partial update — sending only social fields never touches contact fields", async () => {
    const actor = await makeActor();
    await updateStoreConfiguration({ publicPhone: "03571 000000" }, actor.id);
    await updateStoreConfiguration({ instagramUrl: "https://instagram.com/only-this" }, actor.id);

    const config = await getStoreConfiguration();
    expect(config.publicPhone).toBe("03571 000000"); // untouched by the second call
    expect(config.instagramUrl).toBe("https://instagram.com/only-this");
  });

  it("explicit null clears a field (e.g. removing a social link)", async () => {
    const actor = await makeActor();
    await updateStoreConfiguration({ facebookUrl: "https://facebook.com/temp" }, actor.id);
    expect((await getStoreConfiguration()).facebookUrl).toBe("https://facebook.com/temp");

    await updateStoreConfiguration({ facebookUrl: null }, actor.id);
    expect((await getStoreConfiguration()).facebookUrl).toBeNull();
  });

  it("records an audit entry for the update", async () => {
    const actor = await makeActor();
    await updateStoreConfiguration({ publicEmail: "audit-test@chaioboutique.local" }, actor.id);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "StoreConfiguration", userId: actor.id },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.action).toBe("store_settings.updated");
  });
});

describe("store branches (Phase: Public Footer Redesign, real DB)", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "Branches Actor",
      email: `branches-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("seeds the current Embalse branch and leaves Río Tercero inactive", async () => {
    await seedStoreBranches();

    const activeBranches = await listActiveBranches();
    expect(activeBranches.some((branch) => branch.code === "rio-tercero")).toBe(false);

    const embalse = await prisma.storeBranch.findUniqueOrThrow({ where: { code: "embalse" } });
    expect(embalse.name).toBe("Embalse");
    expect(embalse.address).toBe("Av. Pistarini 141");
    expect(embalse.city).toBe("Embalse");
    expect(embalse.province).toBe("Córdoba");
  });

  it("seeding is idempotent — never creates duplicates, never overwrites an admin's later edit", async () => {
    await seedStoreBranches();
    const actor = await makeActor();
    const branch = await prisma.storeBranch.findUniqueOrThrow({ where: { code: "embalse" } });
    await updateBranch(
      branch.id,
      {
        name: "Embalse (renombrada)",
        address: branch.address,
        city: branch.city,
        province: branch.province,
      },
      actor.id,
    );

    const result = await seedStoreBranches();
    expect(result.createdCount).toBe(0);

    const stillRenamed = await prisma.storeBranch.findUniqueOrThrow({ where: { code: "embalse" } });
    expect(stillRenamed.name).toBe("Embalse (renombrada)"); // not clobbered by the re-seed

    // Revert for other tests/files that assume the real seeded name.
    await updateBranch(
      branch.id,
      { name: "Embalse", address: branch.address, city: branch.city, province: branch.province },
      actor.id,
    );
  });

  it("updateBranch persists changes and records an audit entry", async () => {
    await seedStoreBranches();
    const actor = await makeActor();
    const branch = await prisma.storeBranch.findUniqueOrThrow({ where: { code: "embalse" } });

    const updated = await updateBranch(
      branch.id,
      {
        name: "Embalse Centro",
        address: "Nueva Dirección 999",
        city: "Embalse",
        province: "Córdoba",
      },
      actor.id,
    );
    expect(updated.address).toBe("Nueva Dirección 999");

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "StoreBranch", entityId: branch.id },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.action).toBe("store_branch.updated");

    // Revert.
    await updateBranch(
      branch.id,
      { name: "Embalse", address: "Av. Pistarini 141", city: "Embalse", province: "Córdoba" },
      actor.id,
    );
  });

  it("rejects updating a nonexistent branch", async () => {
    const actor = await makeActor();
    await expect(
      updateBranch("nonexistent-id", { name: "X", address: "X", city: "X" }, actor.id),
    ).rejects.toThrow(BranchNotFoundError);
  });

  it("listActiveBranches excludes inactive branches; listBranches includes them", async () => {
    await seedStoreBranches();
    const branch = await prisma.storeBranch.findUniqueOrThrow({ where: { code: "embalse" } });
    await prisma.storeBranch.update({ where: { id: branch.id }, data: { isActive: false } });

    const active = await listActiveBranches();
    expect(active.map((b) => b.code)).not.toContain("embalse");

    const all = await listBranches();
    expect(all.map((b) => b.code)).toContain("embalse");

    // Revert.
    await prisma.storeBranch.update({ where: { id: branch.id }, data: { isActive: true } });
  });
});
