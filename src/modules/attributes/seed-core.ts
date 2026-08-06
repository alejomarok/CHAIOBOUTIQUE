// Node-safe core: no "server-only" import — runnable from prisma/seed.ts
// (via `tsx`, outside the Next.js bundler). Reference-data seeding for the
// store's standard size groups/options — see default-size-data.ts for the
// canonical definitions and DATABASE.md for the documented policy.
import { prisma } from "@/lib/db-core";

import { DEFAULT_SIZE_GROUPS } from "./default-size-data";
import { findSimilarSizeGroups } from "./similarity";
import { createSizeGroup, createSizeOption } from "./service-core";

export interface SizeSeedSummary {
  groupsCreated: string[];
  groupsAlreadyPresent: string[];
  optionsCreated: { groupCode: string; optionCode: string }[];
  optionsAlreadyPresent: { groupCode: string; optionCode: string }[];
  // Existing groups whose code/name looks like it might be the same
  // real-world group as one of the canonical defaults (e.g. an admin's
  // hand-created "PANTS" vs. the canonical PANTALONES_NUMERICOS) — reported
  // only. Never merged, renamed, or deleted automatically; see the
  // "Do not automatically merge groups based only on a similar displayed
  // name" requirement this satisfies.
  possibleDuplicateGroups: {
    defaultCode: string;
    defaultName: string;
    existingCode: string;
    existingName: string;
  }[];
}

// Idempotent: creates only what's missing (by stable `code`, never by
// display name), never updates or deletes an existing row. Re-running this
// after an administrator has renamed a seeded group, reordered its
// options, deactivated one, or created their own custom group is always
// safe — every one of those rows is left exactly as the administrator left
// it, because this function never issues an UPDATE or DELETE at all, only
// CREATE for rows that don't yet exist.
export async function seedDefaultSizeGroups(): Promise<SizeSeedSummary> {
  const summary: SizeSeedSummary = {
    groupsCreated: [],
    groupsAlreadyPresent: [],
    optionsCreated: [],
    optionsAlreadyPresent: [],
    possibleDuplicateGroups: [],
  };

  const existingGroups = await prisma.sizeGroup.findMany();

  for (const groupDef of DEFAULT_SIZE_GROUPS) {
    const existingByCode = existingGroups.find((g) => g.code === groupDef.code);

    // Duplicate detection runs against every OTHER existing group (an exact
    // code match is the same group, not a "possible duplicate" of itself).
    const similar = findSimilarSizeGroups(
      { code: groupDef.code, name: groupDef.name },
      existingGroups.filter((g) => g.code !== groupDef.code),
    );
    for (const match of similar) {
      summary.possibleDuplicateGroups.push({
        defaultCode: groupDef.code,
        defaultName: groupDef.name,
        existingCode: match.code,
        existingName: match.name,
      });
    }

    const group =
      existingByCode ??
      (await createSizeGroup({ code: groupDef.code, name: groupDef.name }, null));

    if (existingByCode) {
      summary.groupsAlreadyPresent.push(groupDef.code);
    } else {
      summary.groupsCreated.push(groupDef.code);
    }

    const existingOptions = await prisma.sizeOption.findMany({ where: { sizeGroupId: group.id } });

    for (const optionDef of groupDef.options) {
      const existingOption = existingOptions.find((o) => o.code === optionDef.code);
      if (existingOption) {
        summary.optionsAlreadyPresent.push({ groupCode: groupDef.code, optionCode: optionDef.code });
        continue;
      }

      await createSizeOption(
        {
          sizeGroupId: group.id,
          code: optionDef.code,
          label: optionDef.label,
          sortOrder: optionDef.sortOrder,
        },
        null,
      );
      summary.optionsCreated.push({ groupCode: groupDef.code, optionCode: optionDef.code });
    }
  }

  return summary;
}

export function printSizeSeedSummary(summary: SizeSeedSummary): void {
  console.log(
    `Size groups: ${summary.groupsCreated.length} created, ${summary.groupsAlreadyPresent.length} already present.`,
  );
  if (summary.groupsCreated.length > 0) {
    console.log(`  Created: ${summary.groupsCreated.join(", ")}`);
  }
  console.log(
    `Size options: ${summary.optionsCreated.length} created, ${summary.optionsAlreadyPresent.length} already present.`,
  );
  if (summary.possibleDuplicateGroups.length > 0) {
    console.log("Possible duplicate size groups (reported only, never auto-merged):");
    for (const dup of summary.possibleDuplicateGroups) {
      console.log(
        `  - default "${dup.defaultCode}" (${dup.defaultName}) looks similar to existing "${dup.existingCode}" (${dup.existingName})`,
      );
    }
  } else {
    console.log("No possible duplicate size groups detected.");
  }
}
