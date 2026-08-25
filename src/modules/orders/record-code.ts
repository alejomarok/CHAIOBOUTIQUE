// Pure — no imports. Mirrors modules/sales/record-code.ts's exact shape
// (timestamp slice + short random suffix), "PED-" prefix ("pedido"). The
// actual uniqueness guarantee comes from modules/orders/order-core.ts's
// DB-backed retry loop plus Order.code's @unique constraint; this alone
// only produces a candidate that's very unlikely to collide, not a promise.
export function buildCandidateOrderCode(): string {
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-5);
  const randomPart = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `PED-${timestampPart}${randomPart}`;
}
