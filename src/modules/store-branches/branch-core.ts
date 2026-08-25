import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) — mirrors
// modules/warehouses/service-core.ts's exact -core/wrapper split.
//
// SCOPE — Phase: Public Footer Redesign. See the StoreBranch model's own
// schema comment: a small, genuinely separate table for CHAIOBOUTIQUE's
// real physical locations, editable from /admin/settings without touching
// React source. Deliberately no create/delete this phase — the two real
// branches are seeded once (see seed-core.ts) and only ever edited
// in-place; add create/delete later if a third branch genuinely needs one,
// rather than building that UI speculatively now.

export class BranchNotFoundError extends Error {
  constructor() {
    super("Sucursal no encontrada.");
    this.name = "BranchNotFoundError";
  }
}

// Public-footer-facing — active branches only, in display order.
export async function listActiveBranches() {
  return prisma.storeBranch.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
  });
}

// Admin-facing — every branch, including any future inactive one.
export async function listBranches() {
  return prisma.storeBranch.findMany({ orderBy: { displayOrder: "asc" } });
}

export interface UpdateBranchInput {
  name: string;
  address: string;
  city: string;
  province?: string | null;
}

export async function updateBranch(id: string, input: UpdateBranchInput, actorId: string) {
  const existing = await prisma.storeBranch.findUnique({ where: { id } });
  if (!existing) throw new BranchNotFoundError();

  const updated = await prisma.storeBranch.update({
    where: { id },
    data: {
      name: input.name,
      address: input.address,
      city: input.city,
      province: input.province || null,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "store_branch.updated",
    entityType: "StoreBranch",
    entityId: id,
    previousValue: {
      name: existing.name,
      address: existing.address,
      city: existing.city,
      province: existing.province,
    },
    newValue: { ...input },
  });

  return updated;
}
