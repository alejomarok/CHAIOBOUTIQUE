import { Prisma } from "@/generated/prisma/client";

// Same defensive shape-checking as modules/inventory/idempotency.ts's
// isIdempotencyKeyConflict — Prisma 7 + @prisma/adapter-pg doesn't always
// populate the classic `meta.target` array; the constraint name can instead
// only be findable inside the wrapped `driverAdapterError`'s message. See
// that file's comment for the full rationale. No "server-only"/db import
// here either, for the same reason: keeps this unit-testable with a bare
// synthetic error object.
function describeUnknown(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Error) {
    const causeText = "cause" in value ? describeUnknown(value.cause) : "";
    return `${value.toString()} ${causeText}`;
  }
  if (typeof value === "string") return value;
  return String(value);
}

// The partial unique index backing "at most one ACTIVE cart per customer" —
// see the migration that introduces it (cart_active_user_unique). Two
// concurrent requests both finding "no active cart yet" for the same
// customer and racing to create one hit this constraint on the loser; the
// caller re-fetches instead of failing the request.
const CART_ACTIVE_USER_CONSTRAINT_NAME = "cart_active_user_unique";

export function isCartActiveUserConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  if (Array.isArray(target) && target.some((t) => String(t).includes("cart_active_user"))) {
    return true;
  }
  if (typeof target === "string" && target.includes("cart_active_user")) return true;

  const haystack = [describeUnknown(error.message), describeUnknown(error.meta?.driverAdapterError)]
    .join(" ")
    .toLowerCase();

  return haystack.includes(CART_ACTIVE_USER_CONSTRAINT_NAME.toLowerCase());
}
