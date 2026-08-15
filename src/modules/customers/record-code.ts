// Pure — no "server-only", no DB/env import — unit-testable in isolation.
// Mirrors modules/customers/customer-code.ts's exact shape (timestamp slice
// + short random suffix) but with a distinct "CLI-" prefix so a Customer's
// code is never visually confused with a CustomerProfile's "C-" code — two
// different models, two different generators. The actual uniqueness
// guarantee comes from modules/customers/customer-core.ts's DB-backed
// retry loop plus Customer.code's @unique constraint; this alone only
// produces a candidate that's very unlikely to collide, not a promise.
export function buildCandidateCustomerRecordCode(): string {
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-5);
  const randomPart = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `CLI-${timestampPart}${randomPart}`;
}
