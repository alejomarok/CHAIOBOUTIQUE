// Pure — no imports. Shared by modules/cart/schemas.ts (Zod validation,
// which must stay import-light enough to unit-test with no DB/env setup)
// and modules/cart/service.ts (the actual enforcement). A single source of
// truth for the limit so the two can never drift apart.
//
// A per-line-item cap, not a cart-total cap — see requirement "quantity does
// not exceed the configured cart limit." A generous retail default;
// tightening this to a business-driven value later needs no schema change.
export const MAX_ITEM_QUANTITY = 20;
