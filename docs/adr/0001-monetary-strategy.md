# ADR-1: Monetary strategy — BigInt minor units, string-based parsing

## Status

Accepted. Applies to every monetary column introduced starting with the catalog/inventory phase
(`Product.defaultPriceAmount`/`compareAtPriceAmount`/`referenceCostAmount`,
`ProductVariant.priceAmount`/`compareAtPriceAmount`/`costAmount`) and to every future monetary
column (purchasing, sales, cash register, expenses).

## Context

[DATABASE.md](../../DATABASE.md) left the integer-type choice for monetary columns open
("`Int`/`BigInt`") pending the phase that actually introduces them. That phase is catalog
pricing. Two questions needed a real decision: which integer width, and how to parse a
human-typed price string into it without floating-point error.

## Decision

**Every monetary column is `BigInt` (Postgres `BIGINT`) storing minor units (ARS centavos) —
never `Int`, never `Float`/`Number`.**

### Why BigInt, not Int

`Int` (Postgres `INTEGER`, 32-bit signed) tops out at ~21.4 million in minor units — i.e.
~214,474 ARS. That ceiling is a real risk specifically in Argentina: the country has a documented
history of sustained high inflation and prior currency redenominations (the 1983, 1985, and 1992
redenominations each stripped zeros off the currency in response to accumulated inflation). Over
a multi-year system lifetime, "will a price ever need more than 6-7 significant digits" is not a
hypothetical here the way it would be in a low-inflation economy — it's a real operational
question. `BigInt` (`BIGINT`, 64-bit signed, range ±9.2×10¹⁸) removes that ceiling entirely at
negligible storage cost (8 bytes vs. 4).

### Why minor units, not a decimal/numeric column

Storing centavos as an integer keeps all arithmetic (sums, comparisons, deltas) as exact integer
math — no rounding behavior to reason about, no `numeric` precision/scale tuning, and it matches
how Mercado Pago's own API represents amounts (a future integration point, not yet built —
see [INTEGRATIONS.md](../../INTEGRATIONS.md)).

### The BigInt/JSON boundary rule

`bigint` is not natively JSON-serializable, and Next.js Server Actions serialize their return
values. Rather than adding exceptions or a custom serializer at the framework level, the rule is
enforced at the module boundary: `src/lib/money.ts` exports `serializeMoney(amount: bigint):
string` and `deserializeMoney(input: string): bigint`. Every DTO-producing function — admin
product responses sent to a Client Component, public catalog queries — calls `serializeMoney`
before returning. Server-to-server service calls (e.g. `products/service.ts` calling
`pricing.ts`) pass `bigint` freely; only the actual client-facing boundary converts to `string`.

### Parsing: string-only, no float ever touches the value

`displayToMinorUnits(rawInput: string): bigint` (`src/lib/money.ts`) never multiplies a parsed
float by 100 — that would reintroduce the exact floating-point error BigInt storage is meant to
avoid. Instead it's pure string manipulation:

1. Strip whitespace/currency symbols.
2. If both `,` and `.` are present, whichever is **rightmost** is the decimal separator; the
   other is a thousands separator and is stripped (`"15.000,50"` → dot is thousands → `15000,50`;
   `"15,000.50"` (US format) → comma is thousands → `15000.50`).
3. If only `,` is present, it's the decimal separator (es-AR convention).
4. If only `.` is present: a 3-digit segment after the last dot is a thousands separator
   (`"15.000"` → 15000, no decimals); 1–2 digits is a decimal separator (`"15000.5"` → 15000.50).
   Documented heuristic, not a universal solver.
5. More than 2 fractional digits is **rejected outright** (`InvalidMoneyInputError`), never
   silently truncated — ARS has no sub-centavo unit, so dropping precision could hide a real
   input mistake rather than represent one.
6. The integer and (zero-padded) fractional digit strings are concatenated and parsed directly
   via `BigInt(digits)` — no `Number()`/`parseFloat()` in the path at all.

`minorUnitsToDisplay` goes the other direction for display only (`Intl.NumberFormat`, which
accepts `bigint` natively) — display formatting is not on the storage/parsing path, so an
`Number()` intermediate there is safe.

### Rounding utility

`roundHalfAwayFromZero(value: number)` exists for the rare future case where a float
intermediate is genuinely unavoidable (e.g. applying a percentage discount to a `bigint` price,
not yet implemented). `Math.round` is **not** round-half-away-from-zero for negative numbers —
`Math.round(-0.5) === -0` (it rounds the halfway case toward +Infinity, not away from zero). The
corrected version:

```ts
function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}
```

Not used by `displayToMinorUnits` itself, which avoids float arithmetic entirely (see above) —
kept for future money math that can't avoid one.

## Consequences

- Every future schema addition with a monetary value must use `BigInt`, never `Int`/`Float`, and
  must go through `serializeMoney`/`deserializeMoney` at the Server Action/Client Component
  boundary. `npm run lint`/code review should catch a stray `Float`/`Int` monetary column or a
  raw `bigint` in a DTO.
- Import rows (`src/modules/imports/row-schemas.ts`) reuse `displayToMinorUnits` directly for
  CSV money columns — the same parsing rules apply to a migrated legacy price as to one typed
  into the admin UI.
- `Prisma.InputJsonValue` (used for `AuditLog.newValue`/`previousValue` and
  `InventoryOperation.metadata`) does not accept `bigint` directly; call sites that log a
  monetary amount into a JSON column call `serializeMoney` first, same as any other
  client-facing boundary.
