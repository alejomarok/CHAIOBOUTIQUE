// Fixed test credentials against TEST_DATABASE_URL only. Never used by the
// production-safe seed (prisma/seed.ts never imports from tests/).
export const ADMIN_FIXTURE = {
  name: "Admin E2E",
  email: "e2e-admin@test.chaioboutique.local",
  password: "password123",
  roleKey: "ADMIN",
};

export const RESTRICTED_FIXTURE = {
  name: "Depósito E2E",
  email: "e2e-warehouse@test.chaioboutique.local",
  password: "password123",
  roleKey: "WAREHOUSE",
};

// emailVerified: true — a real CUSTOMER must verify their email before
// resolvePostLoginDestination sends them to /catalog instead of
// /verify-email (see modules/auth/post-login-redirect.ts); global-setup.ts
// marks this fixture verified directly, standing in for a completed
// real-world verification click.
export const CUSTOMER_FIXTURE = {
  name: "Cliente E2E",
  email: "e2e-customer@test.chaioboutique.local",
  password: "password123",
  roleKey: "CUSTOMER",
  emailVerified: true,
};
