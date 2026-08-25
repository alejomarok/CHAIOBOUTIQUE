import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { expireStaleOrdersAndReservations } from "@/modules/orders/order";

// Protected maintenance endpoint — see this integration's "real scheduler
// preparation" requirement. Previously, reservation expiration only ran
// opportunistically (checkout submission, the admin Orders list, and now
// createMercadoPagoPreference's own per-Order check) — this route is the
// stable target a real scheduled job (cron, a platform's scheduled-task
// feature, ...) can call to sweep the ENTIRE PENDING_PAYMENT backlog on a
// fixed interval, so an abandoned Order's stock is reliably released even
// if nobody happens to touch it again.
//
// Fail-closed authorization: requires the shared secret configured via
// INTERNAL_TASK_SECRET (see env-core.ts) in an `Authorization: Bearer
// <secret>` header, using a constant-time comparison. When
// INTERNAL_TASK_SECRET is unset, this route refuses every request — there
// is no way to invoke it without deliberately configuring it first. No
// production cron is configured by this integration itself (the project's
// deployment environment isn't fixed yet) — see the final report for
// exactly what to configure later (a scheduled HTTP call to this route
// with the configured Bearer token, on an interval shorter than the
// reservation window).
function isAuthorized(request: Request): boolean {
  if (!env.INTERNAL_TASK_SECRET) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.INTERNAL_TASK_SECRET}`;

  const headerBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  if (headerBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(headerBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse(null, { status: 401 });
  }

  const result = await expireStaleOrdersAndReservations();
  console.log("[internal] expire-stale-orders", result);
  return NextResponse.json(result);
}

export async function GET() {
  return new NextResponse(null, { status: 405 });
}
