// Pure — no "server-only", no "@/lib/db"/"@/lib/env" import — so this stays
// importable from a plain unit test with no database/env setup at all. The
// actual uniqueness guarantee comes from modules/customers/service.ts's
// DB-backed retry loop plus CustomerProfile.customerCode's @unique
// constraint; this alone only produces a candidate that's very unlikely to
// collide, not a promise.
//
// Short and human-readable: a timestamp slice (changes every millisecond)
// plus a short random suffix.
export function buildCandidateCustomerCode(): string {
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-5);
  const randomPart = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `C-${timestampPart}${randomPart}`;
}
