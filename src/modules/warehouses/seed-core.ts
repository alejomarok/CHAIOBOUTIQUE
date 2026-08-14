import { prisma } from "@/lib/db-core";

import { createWarehouse, setDefaultWarehouse } from "./service-core";

// Node-safe (no "server-only"), same convention as modules/attributes/
// seed-core.ts. Reference-data seeding, not a schema migration: with zero
// warehouses in the database, stock can never be shown or loaded for any
// product anywhere in the admin UI (getDefaultWarehouse() has nothing to
// return) — this seed exists purely to unblock that dead end on a fresh
// install, exactly like the initial administrator and the default size
// groups. Idempotent by construction: only ever creates when zero
// warehouses exist at all, never touches an admin's later edits (renamed
// warehouse, added a second one, changed which one is default).
const DEFAULT_WAREHOUSE_CODE = "PRINCIPAL";
const DEFAULT_WAREHOUSE_NAME = "Depósito principal";

export interface WarehouseSeedSummary {
  created: boolean;
}

export async function seedDefaultWarehouse(): Promise<WarehouseSeedSummary> {
  const existingCount = await prisma.warehouse.count();
  if (existingCount > 0) {
    return { created: false };
  }

  const warehouse = await createWarehouse(
    { code: DEFAULT_WAREHOUSE_CODE, name: DEFAULT_WAREHOUSE_NAME },
    null,
  );
  await setDefaultWarehouse(warehouse.id, null);

  return { created: true };
}

export function printWarehouseSeedSummary(summary: WarehouseSeedSummary): void {
  console.log(
    summary.created
      ? `Depósito predeterminado creado: ${DEFAULT_WAREHOUSE_NAME} (${DEFAULT_WAREHOUSE_CODE}).`
      : "Depósitos: ya existe al menos uno — no se creó ninguno nuevo.",
  );
}
