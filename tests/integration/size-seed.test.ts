// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { DEFAULT_SIZE_GROUPS } from "@/modules/attributes/default-size-data";
import { createSizeGroup, createSizeOption } from "@/modules/attributes/service";
import { seedDefaultSizeGroups } from "@/modules/attributes/seed-core";
import { cleanupSizeGroupFixtures } from "../fixtures/size-groups";

const DEFAULT_CODES = DEFAULT_SIZE_GROUPS.map((g) => g.code);

async function cleanupSeededDefaults() {
  const groups = await prisma.sizeGroup.findMany({ where: { code: { in: DEFAULT_CODES } } });
  const groupIds = groups.map((g) => g.id);
  const options = await prisma.sizeOption.findMany({
    where: { sizeGroupId: { in: groupIds } },
  });
  await cleanupSizeGroupFixtures({
    sizeOptionIds: options.map((o) => o.id),
    sizeGroupIds: groupIds,
  });
}

describe("seedDefaultSizeGroups — standard size groups reference-data seed (real DB)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    await cleanupSeededDefaults();
  });

  it("creates all 5 canonical groups and every option defined for them", async () => {
    const summary = await seedDefaultSizeGroups();

    expect(summary.groupsCreated.sort()).toEqual([...DEFAULT_CODES].sort());
    expect(summary.groupsAlreadyPresent).toEqual([]);

    const groups = await prisma.sizeGroup.findMany({
      where: { code: { in: DEFAULT_CODES } },
      include: { options: true },
    });
    expect(groups).toHaveLength(DEFAULT_SIZE_GROUPS.length);

    for (const groupDef of DEFAULT_SIZE_GROUPS) {
      const group = groups.find((g) => g.code === groupDef.code);
      expect(group).toBeDefined();
      expect(group?.options.map((o) => o.code).sort()).toEqual(
        groupDef.options.map((o) => o.code).sort(),
      );
    }
  });

  it("running the seed twice creates no duplicates", async () => {
    await seedDefaultSizeGroups();
    const secondRun = await seedDefaultSizeGroups();

    expect(secondRun.groupsCreated).toEqual([]);
    expect(secondRun.groupsAlreadyPresent.sort()).toEqual([...DEFAULT_CODES].sort());
    expect(secondRun.optionsCreated).toEqual([]);

    const groups = await prisma.sizeGroup.findMany({ where: { code: { in: DEFAULT_CODES } } });
    expect(groups).toHaveLength(DEFAULT_SIZE_GROUPS.length);

    const totalOptionsDefined = DEFAULT_SIZE_GROUPS.reduce((sum, g) => sum + g.options.length, 0);
    const options = await prisma.sizeOption.findMany({
      where: { sizeGroupId: { in: groups.map((g) => g.id) } },
    });
    expect(options).toHaveLength(totalOptionsDefined);
  });

  it("does not overwrite an administrator's edits to a pre-existing default group's name or an option's label", async () => {
    const canonical = DEFAULT_SIZE_GROUPS[0];
    const preExisting = await createSizeGroup(
      { code: canonical.code, name: "Nombre editado por el admin" },
      null,
    );
    const editedOption = await createSizeOption(
      {
        sizeGroupId: preExisting.id,
        code: canonical.options[0].code,
        label: "Etiqueta editada por el admin",
      },
      null,
    );

    const summary = await seedDefaultSizeGroups();

    expect(summary.groupsAlreadyPresent).toContain(canonical.code);
    expect(summary.groupsCreated).not.toContain(canonical.code);

    const group = await prisma.sizeGroup.findUniqueOrThrow({ where: { id: preExisting.id } });
    expect(group.name).toBe("Nombre editado por el admin");

    const option = await prisma.sizeOption.findUniqueOrThrow({ where: { id: editedOption.id } });
    expect(option.label).toBe("Etiqueta editada por el admin");

    // Missing options in the same, already-present group are still filled in.
    const allOptions = await prisma.sizeOption.findMany({ where: { sizeGroupId: preExisting.id } });
    expect(allOptions).toHaveLength(canonical.options.length);
  });

  it("preserves a custom size group unrelated to the canonical set", async () => {
    const custom = await createSizeGroup(
      { code: `CUSTOM-${Date.now()}`, name: "Grupo personalizado del admin" },
      null,
    );
    cleanup.push(() => cleanupSizeGroupFixtures({ sizeGroupIds: [custom.id] }));

    await seedDefaultSizeGroups();

    const stillThere = await prisma.sizeGroup.findUnique({ where: { id: custom.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.name).toBe("Grupo personalizado del admin");
  });

  it("reports a similarly named existing group as a possible duplicate without merging or renaming it", async () => {
    const similar = await createSizeGroup(
      { code: `PANTS-${Date.now()}`, name: "Pantalones" },
      null,
    );
    cleanup.push(() => cleanupSizeGroupFixtures({ sizeGroupIds: [similar.id] }));

    const summary = await seedDefaultSizeGroups();

    const flagged = summary.possibleDuplicateGroups.find(
      (entry) => entry.existingCode === similar.code,
    );
    expect(flagged).toBeDefined();
    expect(flagged?.defaultCode).toBe("PANTALONES_NUMERICOS");

    // Never silently merged, renamed, or deleted.
    const unchanged = await prisma.sizeGroup.findUniqueOrThrow({ where: { id: similar.id } });
    expect(unchanged.name).toBe("Pantalones");
    expect(unchanged.code).toBe(similar.code);
  });
});
