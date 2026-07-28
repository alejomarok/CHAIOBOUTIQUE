// Monetary strategy — see docs/adr/0001-monetary-strategy.md. Every stored
// amount is BigInt minor units (ARS centavos). Never Int (Argentina's
// inflation history makes "will this exceed ~21M ARS" a real question over a
// multi-year system lifetime), never Float/Number for storage or parsing.
//
// Boundary rule: bigint is used freely server-to-server. A raw bigint must
// never cross a Server Action / Client Component boundary (it isn't natively
// JSON-serializable) — call serializeMoney() first.

export class InvalidMoneyInputError extends Error {
  constructor(input: string) {
    super(`No se pudo interpretar el monto: "${input}"`);
    this.name = "InvalidMoneyInputError";
  }
}

// General-purpose rounding utility (not used by displayToMinorUnits, which
// avoids floats entirely — see below). Kept for future money math that can't
// avoid a float intermediate (e.g. applying a percentage discount).
// Math.round is NOT round-half-away-from-zero for negatives:
// Math.round(-0.5) === -0 (rounds toward +Infinity for the halfway case).
export function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

const NON_NUMERIC_PATTERN = /[^\d,.\-\s]/g;

// Parses a locale-formatted string into integer minor units, without ever
// performing floating-point arithmetic. Supports (at minimum):
//   "15000"      -> 1500000n
//   "15000,50"   -> 1500050n
//   "15000.50"   -> 1500050n
//   "15.000,50"  -> 1500050n  (es-AR: dot thousands, comma decimal)
// Heuristic for a single "." with no ",": a 3-digit segment after the last
// dot is treated as a thousands separator ("15.000" -> 15000, no decimals);
// 1-2 digits is treated as a decimal separator ("15000.5" -> 15000.50).
// This is documented, not a universal solver. More than 2 fractional digits
// is rejected outright (never silently truncated) since ARS has no
// sub-centavo unit and dropping precision could hide an input mistake.
export function displayToMinorUnits(rawInput: string): bigint {
  const trimmed = rawInput.trim();
  if (trimmed === "") throw new InvalidMoneyInputError(rawInput);

  const cleaned = trimmed.replace(NON_NUMERIC_PATTERN, "").replace(/\s/g, "");

  let negative = false;
  let body = cleaned;
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  }
  if (body === "" || !/^[\d,.]+$/.test(body)) {
    throw new InvalidMoneyInputError(rawInput);
  }

  const hasComma = body.includes(",");
  const hasDot = body.includes(".");

  let integerPart: string;
  let fractionalPart: string;

  if (hasComma && hasDot) {
    const decimalSeparator = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    const withoutThousands = body.split(thousandsSeparator).join("");
    const parts = withoutThousands.split(decimalSeparator);
    if (parts.length !== 2) throw new InvalidMoneyInputError(rawInput);
    [integerPart, fractionalPart] = parts;
  } else if (hasComma) {
    const parts = body.split(",");
    if (parts.length > 2) {
      integerPart = parts.join("");
      fractionalPart = "";
    } else {
      [integerPart, fractionalPart] = parts;
    }
  } else if (hasDot) {
    const parts = body.split(".");
    if (parts.length > 2) {
      integerPart = parts.join("");
      fractionalPart = "";
    } else {
      const [intCandidate, fracCandidate] = parts;
      if (fracCandidate.length === 3) {
        integerPart = intCandidate + fracCandidate;
        fractionalPart = "";
      } else {
        integerPart = intCandidate;
        fractionalPart = fracCandidate;
      }
    }
  } else {
    integerPart = body;
    fractionalPart = "";
  }

  if (integerPart === "") integerPart = "0";
  if (fractionalPart.length > 2) throw new InvalidMoneyInputError(rawInput);

  const digits = `${integerPart}${fractionalPart.padEnd(2, "0")}`;
  if (!/^\d+$/.test(digits)) throw new InvalidMoneyInputError(rawInput);

  const amount = BigInt(digits);
  return negative ? -amount : amount;
}

// String-only conversion from minor units to a "-123.45"-shaped decimal
// string — no float involved. Number() is applied only afterward, and only
// for Intl.NumberFormat's display formatting (see minorUnitsToDisplay),
// never for storage, comparison, or parsing.
function minorUnitsToDecimalString(amountMinorUnits: bigint): string {
  const negative = amountMinorUnits < 0n;
  const absDigits = (negative ? -amountMinorUnits : amountMinorUnits).toString().padStart(3, "0");
  const integerPart = absDigits.slice(0, -2);
  const fractionalPart = absDigits.slice(-2);
  return `${negative ? "-" : ""}${integerPart}.${fractionalPart}`;
}

export function minorUnitsToDisplay(
  amountMinorUnits: bigint,
  options: { currency?: string; locale?: string } = {},
): string {
  const { currency = "ARS", locale = "es-AR" } = options;
  const majorUnits = Number(minorUnitsToDecimalString(amountMinorUnits));
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(majorUnits);
}

// Server Action / Client Component boundary — a raw bigint is never sent
// directly; every DTO-producing function calls these instead.
export function serializeMoney(amountMinorUnits: bigint): string {
  return amountMinorUnits.toString();
}

export function deserializeMoney(input: string): bigint {
  return BigInt(input);
}
