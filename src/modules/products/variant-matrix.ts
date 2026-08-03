// Pure functions — no Prisma, no I/O — so the combination logic is testable
// without a database and mirrors the DB-level uniqueness rules exactly
// (schema.prisma's @@unique([productId, sizeOptionId, colorId]) + the 3
// hand-added partial indexes for the null-axis cases; see DATABASE.md).

export interface VariantAxisCombination {
  sizeOptionId: string | null;
  colorId: string | null;
}

// A product with neither axis gets exactly one default variant. One axis
// only -> one variant per value on that axis. Both axes -> the cartesian
// product. Callers are responsible for passing only sizeOptionIds that
// belong to the product's SizeGroup (see modules/products/service.ts's
// createVariants, the actual enforcement point) — this function has no
// database access and can't check that itself.
export function generateVariantMatrix(
  sizeOptionIds: string[],
  colorIds: string[],
): VariantAxisCombination[] {
  if (sizeOptionIds.length === 0 && colorIds.length === 0) {
    return [{ sizeOptionId: null, colorId: null }];
  }
  if (colorIds.length === 0) {
    return sizeOptionIds.map((sizeOptionId) => ({ sizeOptionId, colorId: null }));
  }
  if (sizeOptionIds.length === 0) {
    return colorIds.map((colorId) => ({ sizeOptionId: null, colorId }));
  }

  const combinations: VariantAxisCombination[] = [];
  for (const sizeOptionId of sizeOptionIds) {
    for (const colorId of colorIds) {
      combinations.push({ sizeOptionId, colorId });
    }
  }
  return combinations;
}

export function isDuplicateCombination(
  existing: readonly VariantAxisCombination[],
  candidate: VariantAxisCombination,
): boolean {
  return existing.some(
    (v) => v.sizeOptionId === candidate.sizeOptionId && v.colorId === candidate.colorId,
  );
}

// Rejects a proposed batch that would create the same (sizeOptionId,
// colorId) pair twice, either against each other or against variants that
// already exist for the product — checked before any DB call, mirroring
// what the unique constraints enforce server-side.
export function findDuplicateCombinationsInBatch(
  alreadyExisting: readonly VariantAxisCombination[],
  proposed: readonly VariantAxisCombination[],
): VariantAxisCombination[] {
  const duplicates: VariantAxisCombination[] = [];
  const seen: VariantAxisCombination[] = [...alreadyExisting];

  for (const candidate of proposed) {
    if (isDuplicateCombination(seen, candidate)) {
      duplicates.push(candidate);
    } else {
      seen.push(candidate);
    }
  }

  return duplicates;
}
