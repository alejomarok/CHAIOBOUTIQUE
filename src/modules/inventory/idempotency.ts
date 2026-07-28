// Idempotency-key generation strategy per source. InventoryOperation.idempotencyKey
// is the real duplicate-prevention mechanism (a dedicated nullable unique
// column) — correlationId is grouping-for-observability only, never used
// for dedup. See docs/adr/0002-inventory-balance-projection.md.

// Manual adjustments and transfers: the caller (an admin form) generates a
// UUID once when it mounts and resubmits the same value on every attempt —
// a double-click or network retry reuses the same key and is rejected as a
// duplicate rather than double-applied. There's nothing to compute
// server-side; the client-supplied UUID *is* the key. This helper exists so
// call sites don't hand-roll the crypto.randomUUID() call inline.
export function generateClientIdempotencyKey(): string {
  return crypto.randomUUID();
}

// Imports: deterministic and derived from the source row's business
// identity, NOT the import batch — this is what makes re-uploading the same
// source file (or a corrected re-export containing the same row) safely
// idempotent regardless of which batch it came from. Scoped by
// (sourceSystem, legacyId), not importBatchId.
export function buildImportIdempotencyKey(input: {
  operationType: "initial_stock" | "adjustment";
  sourceSystem: string;
  legacyId: string;
}): string {
  return `import:${input.operationType}:${input.sourceSystem}:${input.legacyId}`;
}

// Future webhooks (documented for later phases, not implemented now): use
// the provider's own delivery/event id as the key, e.g.:
//   `webhook:mercadopago:${event.id}`
