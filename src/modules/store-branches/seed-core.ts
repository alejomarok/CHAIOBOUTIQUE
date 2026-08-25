import { prisma } from "@/lib/db-core";

// Node-safe (no "server-only"), same convention as modules/warehouses/
// seed-core.ts. Seeds CHAIOBOUTIQUE's two real, current physical branches —
// this is the single source of truth for that text; nothing else in the
// codebase hard-codes it (see this phase's explicit "avoid hardcoding the
// same branch text in multiple components" requirement). Idempotent
// per-branch (checked by `code`, never by a blanket "any branch exists"
// count) — an admin's later edit to either branch's name/address is never
// overwritten by a repeated seed run, and a future third branch could be
// added to this list without re-touching the first two.
const SEED_BRANCHES = [
  {
    code: "rio-tercero",
    name: "Río Tercero",
    address: "Libertad 161",
    city: "Río Tercero",
    province: "Córdoba",
    displayOrder: 0,
  },
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
