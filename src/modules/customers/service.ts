import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import type { CustomerProfile, Prisma } from "@/generated/prisma/client";

import { createCustomerForRegisteredUser } from "./customer-core";
import { buildCandidateCustomerCode } from "./customer-code";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "./legal";

async function generateCustomerCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = buildCandidateCustomerCode();
    const collision = await tx.customerProfile.count({ where: { customerCode: candidate } });
    if (collision === 0) return candidate;
  }
  throw new Error("No se pudo generar un código de clienta único.");
}

// Written immediately after Better Auth's signUpEmail succeeds — the
// durable marker proving a User row originated from public
// self-registration. Idempotent (upsert): safe if a retry ever calls this
// twice for the same user. See PublicRegistrationIntent's schema comment
// and docs/adr/0003-customer-registration.md.
export async function createRegistrationIntent(userId: string): Promise<void> {
  await prisma.publicRegistrationIntent.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

// Marks the intent fulfilled once registerCustomer's transaction has
// committed. Deliberately NOT an upsert: a missing intent row here means
// createRegistrationIntent was never called for this user, which is a real
// ordering bug worth surfacing loudly (P2025) rather than silently
// papering over by creating a phantom already-completed intent.
export async function completeRegistrationIntent(userId: string): Promise<void> {
  await prisma.publicRegistrationIntent.update({
    where: { userId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

async function ensureCustomerRoleAssignment(
  tx: Prisma.TransactionClient,
  userId: string,
  customerRoleId: string,
): Promise<void> {
  // assignedBy: null, not userId — this is a system action the new account
  // didn't "perform" on itself. See ADR-3 / recordAuditLog calls below for
  // the matching audit-actor convention.
  await tx.userRole.upsert({
    where: { userId_roleId: { userId, roleId: customerRoleId } },
    update: {},
    create: { userId, roleId: customerRoleId, assignedBy: null },
  });
}

export interface RegisterCustomerInput {
  userId: string;
  marketingConsent: boolean;
  termsVersion: string;
  privacyVersion: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// The one place a User row becomes a real, usable customer account:
// CustomerProfile + the initial CustomerConsent ledger rows + the CUSTOMER
// role assignment + both audit entries, all inside one transaction — atomic
// for everything under this application's control (see ADR-3 for the
// documented, unavoidable gap between this and Better Auth's own User
// insert, which happens earlier and is a separate transaction boundary).
//
// Idempotent by construction: if a CustomerProfile already exists for this
// userId (e.g. reconcileAbandonedRegistrations repairing a crashed prior
// attempt), this never re-writes CustomerProfile or re-records consent
// history — it only (re-)ensures the role assignment holds, since that's
// the one part a crash could plausibly have skipped.
export async function registerCustomer(input: RegisterCustomerInput): Promise<CustomerProfile> {
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });

  return prisma.$transaction(async (tx) => {
    // Ensures the commercial Customer row exists and is linked, regardless
    // of which branch below runs — createCustomerForRegisteredUser is
    // itself idempotent per userId, so this is safe to call unconditionally
    // even on the "already registered, just repairing the role" path (e.g.
    // an account that predates this phase and was never backfilled). See
    // schema.prisma's Customer model comment: this is a 1:1 creation for
    // one User, never a match/merge against existing Customer rows.
    await createCustomerForRegisteredUser(tx, input.userId);

    const existing = await tx.customerProfile.findUnique({ where: { userId: input.userId } });
    if (existing) {
      await ensureCustomerRoleAssignment(tx, input.userId, customerRole.id);
      return existing;
    }

    const now = new Date();

    const profile = await tx.customerProfile.create({
      data: {
        userId: input.userId,
        customerCode: await generateCustomerCode(tx),
        marketingConsent: input.marketingConsent,
        marketingConsentAt: input.marketingConsent ? now : null,
        termsAcceptedAt: now,
        termsVersion: input.termsVersion,
        privacyAcceptedAt: now,
        privacyVersion: input.privacyVersion,
      },
    });

    const consentEvents: Prisma.CustomerConsentCreateManyInput[] = [
      {
        customerProfileId: profile.id,
        consentType: "TERMS_ACCEPTED",
        granted: true,
        policyVersion: input.termsVersion,
        source: "public_registration",
        occurredAt: now,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      {
        customerProfileId: profile.id,
        consentType: "PRIVACY_ACCEPTED",
        granted: true,
        policyVersion: input.privacyVersion,
        source: "public_registration",
        occurredAt: now,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    ];
    if (input.marketingConsent) {
      consentEvents.push({
        customerProfileId: profile.id,
        consentType: "MARKETING_GRANTED",
        granted: true,
        policyVersion: input.termsVersion,
        source: "public_registration",
        occurredAt: now,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      });
    }
    await tx.customerConsent.createMany({ data: consentEvents });

    await ensureCustomerRoleAssignment(tx, input.userId, customerRole.id);

    // System-initiated, not self-performed — userId: null, the affected
    // account recorded separately via entityId. See
    // docs/adr/0003-customer-registration.md.
    await recordAuditLog(
      {
        userId: null,
        action: "customer.registered",
        entityType: "User",
        entityId: input.userId,
        newValue: { customerCode: profile.customerCode },
        metadata: { source: "public_registration" },
      },
      tx,
    );
    await recordAuditLog(
      {
        userId: null,
        action: "user.role_assigned",
        entityType: "User",
        entityId: input.userId,
        newValue: { roleKey: "CUSTOMER" },
        metadata: { source: "public_registration" },
      },
      tx,
    );

    return profile;
  });
}

// Repairs a registration that crashed between createRegistrationIntent and
// registerCustomer's transaction committing — scoped strictly to Users with
// BOTH zero roles AND a matching PENDING PublicRegistrationIntent, never
// "any zero-role user" (a broken staff-creation call, for instance, must
// never be auto-converted into a customer — see ADR-3). Safe to call
// repeatedly: registerCustomer is itself idempotent.
export async function reconcileAbandonedRegistrations(): Promise<{ repairedUserIds: string[] }> {
  const stuck = await prisma.user.findMany({
    where: {
      userRoles: { none: {} },
      registrationIntent: { status: "PENDING" },
    },
    select: { id: true },
  });

  const repairedUserIds: string[] = [];
  for (const user of stuck) {
    // A repair run has no access to what the original crashed request
    // actually submitted — it conservatively assumes no marketing opt-in
    // (never fabricates consent beyond the minimum required to reach this
    // point) and today's current legal versions.
    await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
    await completeRegistrationIntent(user.id);
    repairedUserIds.push(user.id);
  }

  return { repairedUserIds };
}
