// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import {
  completeRegistrationIntent,
  createRegistrationIntent,
  reconcileAbandonedRegistrations,
  registerCustomer,
} from "@/modules/customers/service";
import { backfillCustomersForRegisteredUsers } from "@/modules/customers/seed-core";

describe("customer registration — profile, role, consent, reconciliation (real DB)", () => {
  const createdUserIds: string[] = [];

  // No per-entity cleanup here, deliberately — same reasoning as
  // inventory.test.ts: audit_log/customer_consent are append-only, and
  // per-entity teardown can't safely unwind them. The isolated test
  // database's full reset (tests/integration/reset-db.ts) handles this
  // between `npm run test:integration` runs.
  afterEach(async () => {
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function createRawUser(emailPrefix: string) {
    // Bypasses createRegistrationIntent/registerCustomer entirely — a raw
    // Better Auth signup with zero roles and no intent row, exactly what a
    // broken non-registration user-creation path would look like.
    const user = await createTestUser({
      name: "Raw User",
      email: `${emailPrefix}-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(user.id);
    return user;
  }

  it("creates exactly one CustomerProfile, the CUSTOMER role, and the initial consent ledger", async () => {
    const user = await createRawUser("register");

    const profile = await registerCustomer({
      userId: user.id,
      marketingConsent: true,
      termsVersion: "v1",
      privacyVersion: "v1",
    });

    const profiles = await prisma.customerProfile.findMany({ where: { userId: user.id } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(profile.id);
    expect(profiles[0].marketingConsent).toBe(true);
    expect(profiles[0].termsVersion).toBe("v1");
    expect(profiles[0].privacyVersion).toBe("v1");

    const roles = await prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });
    expect(roles).toHaveLength(1);
    expect(roles[0].role.key).toBe("CUSTOMER");

    const consents = await prisma.customerConsent.findMany({
      where: { customerProfileId: profile.id },
      orderBy: { consentType: "asc" },
    });
    expect(consents.map((c) => c.consentType).sort()).toEqual([
      "MARKETING_GRANTED",
      "PRIVACY_ACCEPTED",
      "TERMS_ACCEPTED",
    ]);
    expect(consents.every((c) => c.granted)).toBe(true);
  });

  it("does not record a MARKETING_GRANTED event when marketing consent was not given", async () => {
    const user = await createRawUser("no-marketing");

    const profile = await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });

    const consents = await prisma.customerConsent.findMany({
      where: { customerProfileId: profile.id },
    });
    expect(consents).toHaveLength(2);
    expect(consents.some((c) => c.consentType === "MARKETING_GRANTED")).toBe(false);
  });

  it("assigns the CUSTOMER role as a system action, not a self-performed one", async () => {
    const user = await createRawUser("system-actor");

    await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
    const userRole = await prisma.userRole.findUniqueOrThrow({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
    });
    expect(userRole.assignedBy).toBeNull();

    const roleAuditEntry = await prisma.auditLog.findFirst({
      where: { action: "user.role_assigned", entityId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(roleAuditEntry).not.toBeNull();
    expect(roleAuditEntry?.userId).toBeNull();
    expect(roleAuditEntry?.metadata).toMatchObject({ source: "public_registration" });

    const registrationAuditEntry = await prisma.auditLog.findFirst({
      where: { action: "customer.registered", entityId: user.id },
    });
    expect(registrationAuditEntry).not.toBeNull();
    expect(registrationAuditEntry?.userId).toBeNull();
  });

  it("is idempotent: re-running for the same user never duplicates the profile, role, or consent history", async () => {
    const user = await createRawUser("idempotent");

    const first = await registerCustomer({
      userId: user.id,
      marketingConsent: true,
      termsVersion: "v1",
      privacyVersion: "v1",
    });
    const second = await registerCustomer({
      userId: user.id,
      marketingConsent: true,
      termsVersion: "v1",
      privacyVersion: "v1",
    });

    expect(second.id).toBe(first.id);

    const profiles = await prisma.customerProfile.findMany({ where: { userId: user.id } });
    expect(profiles).toHaveLength(1);

    const roles = await prisma.userRole.findMany({ where: { userId: user.id } });
    expect(roles).toHaveLength(1);

    const consents = await prisma.customerConsent.findMany({
      where: { customerProfileId: first.id },
    });
    expect(consents).toHaveLength(3); // not 6 — never re-recorded on the second call
  });

  it("registerCustomer also auto-creates and links a commercial Customer row, in the same transaction", async () => {
    const user = await createRawUser("commercial-link");

    await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });

    const linkedCustomer = await prisma.customer.findUnique({ where: { linkedUserId: user.id } });
    expect(linkedCustomer).not.toBeNull();
    expect(linkedCustomer?.type).toBe("PERSON");
    expect(linkedCustomer?.createdById).toBeNull(); // system-initiated, not a self-performed action
  });

  it("re-registering the same user never creates a second linked Customer", async () => {
    const user = await createRawUser("commercial-link-idempotent");

    await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });
    await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });

    const linkedCustomers = await prisma.customer.count({ where: { linkedUserId: user.id } });
    expect(linkedCustomers).toBe(1);
  });

  it("backfillCustomersForRegisteredUsers links a Customer to an already-registered account that predates it", async () => {
    const user = await createRawUser("predates-backfill");
    await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });
    // Simulate "this account predates commercial Customer" by removing the
    // link registerCustomer itself just created — the exact gap the
    // backfill exists to repair for real pre-existing dev/prod data.
    await prisma.customer.deleteMany({ where: { linkedUserId: user.id } });

    const before = await prisma.customer.findUnique({ where: { linkedUserId: user.id } });
    expect(before).toBeNull();

    const { linkedCount } = await backfillCustomersForRegisteredUsers();
    expect(linkedCount).toBeGreaterThan(0);

    const after = await prisma.customer.findUnique({ where: { linkedUserId: user.id } });
    expect(after).not.toBeNull();
  });

  it("the database rejects a direct UPDATE on customer_consent (append-only trigger)", async () => {
    const user = await createRawUser("consent-update");
    const profile = await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });
    const [consent] = await prisma.customerConsent.findMany({
      where: { customerProfileId: profile.id },
    });

    await expect(
      prisma.$executeRaw`UPDATE customer_consent SET granted = false WHERE id = ${consent.id}`,
    ).rejects.toThrow();
  });

  it("the database rejects a direct DELETE on customer_consent (append-only trigger)", async () => {
    const user = await createRawUser("consent-delete");
    const profile = await registerCustomer({
      userId: user.id,
      marketingConsent: false,
      termsVersion: "v1",
      privacyVersion: "v1",
    });
    const [consent] = await prisma.customerConsent.findMany({
      where: { customerProfileId: profile.id },
    });

    await expect(
      prisma.$executeRaw`DELETE FROM customer_consent WHERE id = ${consent.id}`,
    ).rejects.toThrow();
  });

  it("reconciliation repairs a crashed registration (intent exists, setup never finished)", async () => {
    const result = await auth.api.signUpEmail({
      body: {
        name: "Crashed Mid Flow",
        email: `crashed-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
        password: "password123",
      },
    });
    createdUserIds.push(result.user.id);

    // Simulates step 3 having run but step 4-6 (registerCustomer) never
    // completing — the exact gap reconciliation exists to repair.
    await createRegistrationIntent(result.user.id);

    const before = await prisma.customerProfile.findUnique({ where: { userId: result.user.id } });
    expect(before).toBeNull();

    const { repairedUserIds } = await reconcileAbandonedRegistrations();
    expect(repairedUserIds).toContain(result.user.id);

    const after = await prisma.customerProfile.findUnique({ where: { userId: result.user.id } });
    expect(after).not.toBeNull();

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
    const userRole = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: result.user.id, roleId: role.id } },
    });
    expect(userRole).not.toBeNull();

    const intent = await prisma.publicRegistrationIntent.findUniqueOrThrow({
      where: { userId: result.user.id },
    });
    expect(intent.status).toBe("COMPLETED");
  });

  it("reconciliation never touches a zero-role user with no matching registration intent", async () => {
    // A broken staff-creation call, or any other zero-role user that never
    // went through public registration at all — must never be
    // auto-converted into a customer. See docs/adr/0003-customer-registration.md.
    const user = await createRawUser("broken-staff");

    const rolesBefore = await prisma.userRole.count({ where: { userId: user.id } });
    expect(rolesBefore).toBe(0);

    const { repairedUserIds } = await reconcileAbandonedRegistrations();
    expect(repairedUserIds).not.toContain(user.id);

    const profile = await prisma.customerProfile.findUnique({ where: { userId: user.id } });
    expect(profile).toBeNull();
    const rolesAfter = await prisma.userRole.count({ where: { userId: user.id } });
    expect(rolesAfter).toBe(0);
  });

  it("completeRegistrationIntent throws if no intent row exists for that user (ordering bug, not silently papered over)", async () => {
    const user = await createRawUser("no-intent");
    await expect(completeRegistrationIntent(user.id)).rejects.toThrow();
  });
});
