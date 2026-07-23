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
