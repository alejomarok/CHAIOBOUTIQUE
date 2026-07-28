// Pure functions — no Prisma, no I/O — so the combination logic is testable
// without a database and mirrors the DB-level uniqueness rules exactly
// (schema.prisma's @@unique([productId, sizeId, colorId]) + the 3 hand-added
// partial indexes for the null-axis cases; see DATABASE.md).

export interface VariantAxisCombination {
  sizeId: string | null;
  colorId: string | null;
}

// A product with neither axis gets exactly one default variant. One axis
// only -> one variant per value on that axis. Both axes -> the cartesian
// product.
export function generateVariantMatrix(
  sizeIds: string[],
  colorIds: string[],
): VariantAxisCombination[] {
  if (sizeIds.length === 0 && colorIds.length === 0) {
    return [{ sizeId: null, colorId: null }];
  }
  if (colorIds.length === 0) {
    return sizeIds.map((sizeId) => ({ sizeId, colorId: null }));
  }
  if (sizeIds.length === 0) {
    return colorIds.map((colorId) => ({ sizeId: null, colorId }));
  }

  const combinations: VariantAxisCombination[] = [];
  for (const sizeId of sizeIds) {
    for (const colorId of colorIds) {
      combinations.push({ sizeId, colorId });
    }
  }
  return combinations;
}

export function isDuplicateCombination(
  existing: readonly VariantAxisCombination[],
  candidate: VariantAxisCombination,
): boolean {
  return existing.some((v) => v.sizeId === candidate.sizeId && v.colorId === candidate.colorId);
}

// Rejects a proposed batch that would create the same (sizeId, colorId) pair
// twice, either against each other or against variants that already exist
// for the product — checked before any DB call, mirroring what the unique
// constraints enforce server-side.
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
