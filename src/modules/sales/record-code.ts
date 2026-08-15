// Pure — no "server-only", no DB/env import — unit-testable in isolation.
// Mirrors modules/customers/record-code.ts's exact shape (timestamp slice +
// short random suffix), "VEN-" prefix ("venta"). The actual uniqueness
// guarantee comes from modules/sales/sale-core.ts's DB-backed retry loop
// plus Sale.code's @unique constraint; this alone only produces a candidate
// that's very unlikely to collide, not a promise.
export function buildCandidateSaleCode(): string {
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-5);
  const randomPart = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `VEN-${timestampPart}${randomPart}`;
}
