// @vitest-environment node
import "./guard";

import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { getDefaultWarehouse } from "@/modules/warehouses/service";
import { seedDefaultWarehouse } from "@/modules/warehouses/seed-core";

describe("seedDefaultWarehouse — default warehouse reference-data seed (real DB)", () => {
  it("the global test-database reset already produced a default warehouse (seeded from empty)", async () => {
    // tests/integration/global-setup.ts truncates every table (including
    // warehouse) and then calls this exact seed once before any test file
    // runs — proving "creates one when none exist" without this test having
    // to unsafely truncate a table shared by every other concurrently
    // registered test in this file's run.
    const defaultWarehouse = await getDefaultWarehouse();
    expect(defaultWarehouse).not.toBeNull();
    expect(defaultWarehouse?.isDefault).toBe(true);
  });

  it("running the seed again when a warehouse already exists creates no duplicate", async () => {
    const before = await prisma.warehouse.count();

    const summary = await seedDefaultWarehouse();

    expect(summary.created).toBe(false);
    const after = await prisma.warehouse.count();
    expect(after).toBe(before);
  });

  it("does not touch an existing default warehouse's fields", async () => {
    const before = await getDefaultWarehouse();
    expect(before).not.toBeNull();

    await seedDefaultWarehouse();

    const after = await getDefaultWarehouse();
    expect(after?.id).toBe(before?.id);
    expect(after?.code).toBe(before?.code);
    expect(after?.name).toBe(before?.name);
  });
});
