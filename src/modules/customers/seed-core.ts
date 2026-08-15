import { prisma } from "@/lib/db-core";

import { createCustomerForRegisteredUser } from "./customer-core";

// Idempotent, same pattern as modules/warehouses/seed-core.ts's
// seedDefaultWarehouse: a guard check (does a system customer already
// exist?) rather than a name lookup, so it never fights a later admin edit
// (e.g. if "Consumidor Final" is ever renamed). Never touches an existing
// row.
const CONSUMIDOR_FINAL_CODE = "CONSUMIDOR-FINAL";

export interface ConsumidorFinalSeedSummary {
  created: boolean;
}

export async function seedConsumidorFinal(): Promise<ConsumidorFinalSeedSummary> {
  const existing = await prisma.customer.findFirst({ where: { isSystemDefault: true } });
  if (existing) {
    return { created: false };
  }

  await prisma.customer.create({
    data: {
      code: CONSUMIDOR_FINAL_CODE,
      type: "PERSON",
      firstName: "Consumidor",
      lastName: "Final",
      taxCondition: "CONSUMIDOR_FINAL",
      isActive: true,
      isSystemDefault: true,
      notes:
        "Cliente del sistema para ventas rápidas sin identificar a la persona compradora. No editable ni eliminable.",
    },
  });

  return { created: true };
}

export function printConsumidorFinalSeedSummary(summary: ConsumidorFinalSeedSummary): void {
  console.log(
    summary.created
      ? "Cliente del sistema creado: Consumidor Final."
      : "Consumidor Final: ya existe — no se creó ninguno nuevo.",
  );
}

// Retroactively gives every ALREADY-registered web account (User +
// CustomerProfile pairs that predate this phase, or that were created by a
// test/dev run before commercial Customer existed) the same auto-linked
// Customer row a NEW registration gets automatically going forward — see
// modules/customers/customer-core.ts's createCustomerForRegisteredUser,
// reused here unchanged rather than reimplemented. Idempotent: a User that
// already has a linked Customer is skipped (createCustomerForRegisteredUser
// itself is idempotent per-user); safe to run on every `prisma db seed`,
// including production, where it's naturally a no-op once every registered
// account has been backfilled once. Never touches CustomerProfile itself —
// no existing registration data is read destructively or discarded, only
// used to derive a new, additive Customer row.
export interface CustomerBackfillSummary {
  linkedCount: number;
}

export async function backfillCustomersForRegisteredUsers(): Promise<CustomerBackfillSummary> {
  const registeredUsers = await prisma.user.findMany({
    where: { customerProfile: { isNot: null }, linkedCustomer: { is: null } },
    select: { id: true },
  });

  let linkedCount = 0;
  for (const user of registeredUsers) {
    await prisma.$transaction((tx) => createCustomerForRegisteredUser(tx, user.id));
    linkedCount++;
  }

  return { linkedCount };
}

export function printCustomerBackfillSummary(summary: CustomerBackfillSummary): void {
  console.log(
    summary.linkedCount > 0
      ? `Clientes vinculados retroactivamente a cuentas ya registradas: ${summary.linkedCount}.`
      : "Vinculación retroactiva de clientes: nada pendiente.",
  );
}
