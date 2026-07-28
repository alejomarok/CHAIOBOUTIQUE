import "server-only";

// The actual implementations live in seed-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (prisma/seed.ts via `tsx`) — see that file and ARCHITECTURE.md.
export { seedPermissions, seedRolesAndAssignments, seedStoreConfiguration } from "./seed-core";
