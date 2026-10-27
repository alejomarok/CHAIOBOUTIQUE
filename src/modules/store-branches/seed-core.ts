import { prisma } from "@/lib/db-core";

// Node-safe (no "server-only"), same convention as modules/warehouses/
// seed-core.ts. Seeds CHAIOBOUTIQUE's current physical branch —
// this is the single source of truth for that text; nothing else in the
// codebase hard-codes it (see this phase's explicit "avoid hardcoding the
// same branch text in multiple components" requirement). Idempotent
// per-branch (checked by `code`, never by a blanket "any branch exists"
// count) — an admin's later edit to a branch's name/address is never
// overwritten by a repeated seed run. Future locations can be added here.
const SEED_BRANCHES = [
  {
    code: "embalse",
    name: "Embalse",
    address: "Av. Pistarini 141",
    city: "Embalse",
    province: "Córdoba",
    displayOrder: 1,
  },
] as const;

export interface BranchSeedSummary {
  createdCount: number;
}

export async function seedStoreBranches(): Promise<BranchSeedSummary> {
  let createdCount = 0;
  for (const branch of SEED_BRANCHES) {
    const existing = await prisma.storeBranch.findUnique({ where: { code: branch.code } });
    if (existing) continue;
    await prisma.storeBranch.create({ data: branch });
    createdCount += 1;
  }
  return { createdCount };
}

export function printBranchSeedSummary(summary: BranchSeedSummary): void {
  console.log(
    summary.createdCount > 0
      ? `Sucursales creadas: ${summary.createdCount}.`
      : "Sucursales: ya existen — no se creó ninguna nueva.",
  );
}
