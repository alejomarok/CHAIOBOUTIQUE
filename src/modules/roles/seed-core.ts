import { prisma } from "@/lib/db-core";
import { PERMISSIONS, PERMISSION_LABELS_ES } from "@/modules/permissions/catalog";

import { ROLE_DEFINITIONS } from "./catalog";

// Node-safe core: no "server-only" import, and imports db-core.ts (not
// db.ts) so this stays importable from prisma/seed.ts via `tsx` — see
// src/modules/roles/seed.ts and ARCHITECTURE.md. Also imported directly by
// integration tests (vitest aliases "server-only" to a no-op, so those could
// import the src/modules/roles/seed.ts wrapper too, but importing the core
// here keeps one obviously-CLI-safe entry point for both callers).
//
// Pure upsert/additive logic, no admin-account side effects, so it's safe to
// call repeatedly and safe to exercise directly against TEST_DATABASE_URL.
export async function seedPermissions(): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSION_LABELS_ES[key] },
      create: { key, description: PERMISSION_LABELS_ES[key] },
    });
  }
}

export async function seedRolesAndAssignments(): Promise<void> {
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: { name: definition.nameEs, description: definition.descriptionEs },
      create: {
        key: definition.key,
        name: definition.nameEs,
        description: definition.descriptionEs,
        isSystem: true,
      },
    });

    if (definition.permissions.length === 0) continue;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...definition.permissions] } },
      select: { id: true },
    });

    // Additive only (skipDuplicates, no deleteMany): a re-seed never
    // clobbers permission edits made later through the admin UI.
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }
}

export async function seedStoreConfiguration(input: {
  name: string;
  currency: string;
  locale: string;
  timezone: string;
}): Promise<void> {
  await prisma.storeConfiguration.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main", ...input },
  });
}

// Phase — Mercado Pago Checkout Pro integration. Same idempotent-by-flag
// pattern as modules/customers/seed-core.ts's seedConsumidorFinal — a guard
// check (does a system account already exist?), never a name/email lookup,
// so this never fights a later admin edit and is safe to run on every
// `prisma db seed`. Deliberately created via a direct prisma.user.create,
// never Better Auth's signUpEmail: this row must have no Account/password
// at all, so it can never sign in — see User.isSystemAccount's own schema
// comment.
const SYSTEM_ACCOUNT_EMAIL = "sistema@chaioboutique.internal";

export interface SystemAccountSeedSummary {
  created: boolean;
}

export async function seedSystemAccount(): Promise<SystemAccountSeedSummary> {
  const existing = await prisma.user.findFirst({ where: { isSystemAccount: true } });
  if (existing) return { created: false };

  await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      name: "Sistema",
      email: SYSTEM_ACCOUNT_EMAIL,
      emailVerified: true,
      isActive: true,
      isSystemAccount: true,
    },
  });

  return { created: true };
}

export function printSystemAccountSeedSummary(summary: SystemAccountSeedSummary): void {
  console.log(
    summary.created
      ? "Cuenta del sistema creada: Sistema."
      : "Cuenta del sistema: ya existe — no se creó ninguna nueva.",
  );
}

// The runtime lookup every automated, no-human-present write uses (see
// modules/orders/order-core.ts's finalizePaidOrder) — mirrors modules/
// customers/customer-core.ts's getSystemDefaultCustomer exactly (a guard
// check by flag, never a hardcoded id). Throws rather than returning null:
// unlike a merely-missing optional feature, a finalizePaidOrder call with
// no system account seeded is a genuine deployment-configuration error that
// must never proceed silently (e.g. by falling back to some arbitrary real
// staff account as the payment's attributed actor).
export class SystemAccountNotSeededError extends Error {
  constructor() {
    super("La cuenta del sistema no está creada. Ejecutá el seed de la base de datos.");
    this.name = "SystemAccountNotSeededError";
  }
}

export async function getSystemAccountUserId(): Promise<string> {
  const account = await prisma.user.findFirst({ where: { isSystemAccount: true }, select: { id: true } });
  if (!account) throw new SystemAccountNotSeededError();
  return account.id;
}
