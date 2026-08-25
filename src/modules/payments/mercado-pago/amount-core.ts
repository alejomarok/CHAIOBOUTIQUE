import { minorUnitsToDecimalString } from "@/lib/money";

// The one deliberate float boundary in this integration — see this
// integration's env/amount-verification design notes. Every OTHER money
// value in this codebase is BigInt minor units end-to-end (see
// docs/adr/0001-monetary-strategy.md); this file exists specifically
// because the Mercado Pago API itself represents amounts as a JSON decimal
// number, both when we SEND a preference's unit_price and when we RECEIVE a
// payment's transaction_amount — a real external boundary, not a choice
// made in this codebase.

// BigInt minor units -> the plain decimal number Mercado Pago's API expects
// for `unit_price` (e.g. 150050n -> 1500.50). Reuses minorUnitsToDecimalString
// (string-only, no float) for the actual digit-slicing, and only converts to
// Number() at the very last step, right where the SDK's own type requires a
// `number` — the exact same "Number() only at the presentation/serialization
// boundary" posture minorUnitsToDisplay already uses.
export function minorUnitsToMercadoPagoAmount(amountMinorUnits: bigint): number {
  return Number(minorUnitsToDecimalString(amountMinorUnits));
}

// The reverse conversion, applied to whatever the Mercado Pago API returns
// (transaction_amount) — already a float by the time it reaches us (it came
// in as a JSON number), so Math.round is the correct, standard way to
// recover the exact integer minor-units value without floating-point
// representation artifacts (e.g. 1234.56 * 100 can land on
// 123455.99999999999 in IEEE 754 — Math.round corrects that safely for any
// realistic currency amount, far below the 2^53 safe-integer ceiling).
export function mercadoPagoAmountToMinorUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}
