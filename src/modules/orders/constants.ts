// Pure — no imports. Centralizes business policy that would otherwise be
// hard-coded throughout the checkout/reservation flow — see this phase's
// explicit "do not hard-code business policy throughout the codebase"
// requirement. Mirrors modules/cart/constants.ts's exact posture
// (MAX_ITEM_QUANTITY/ANONYMOUS_CART_TTL_DAYS).

// How long a checkout's stock reservation stays ACTIVE before the
// expiration sweep (see modules/orders/order-core.ts's
// expireStaleOrdersAndReservations) releases it back to "available to
// sell". Within this phase's suggested 15-30 minute range. Every "your
// order is reserved for N minutes" message in the UI reads this constant —
// never a separately hand-typed number, so the promised duration is always
// the one actually enforced.
export const RESERVATION_WINDOW_MINUTES = 20;
