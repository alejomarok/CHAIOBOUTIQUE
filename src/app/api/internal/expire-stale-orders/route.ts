import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInternalTaskAuthorized } from "@/lib/internal-task-auth";
import { processEmailOutbox } from "@/modules/email/outbox-core";
import { expireStaleOrdersAndReservations } from "@/modules/orders/order";

export const runtime = "nodejs";
export const maxDuration = 60;

async function runMaintenance(request: Request) {
  if (!isInternalTaskAuthorized(request)) return new NextResponse(null, { status: 401 });
  try {
    const reservations = await expireStaleOrdersAndReservations();
    const mail = await processEmailOutbox(4);
    const yesterday = new Date(Date.now() - 86_400_000);
    await prisma.appRateLimit.deleteMany({ where: { expiresAt: { lt: yesterday } } });
    await prisma.rateLimit.deleteMany({
      where: { lastRequest: { lt: BigInt(yesterday.getTime()) } },
    });
    // Keep idempotency tombstones, remove delivered message contents after 30 days.
    await prisma.emailOutbox.updateMany({
      where: { status: "SENT", deliveredAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
      data: { encryptedPayload: null, recipient: null },
    });
    const failedEmails = await prisma.emailOutbox.count({ where: { status: "FAILED" } });
    const result = { ...reservations, mail, failedEmails };
    console.info("[maintenance] completed", result);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[maintenance] failed");
    return NextResponse.json({ error: "Maintenance failed" }, { status: 500 });
  }
}

// Vercel invokes GET with Bearer CRON_SECRET. Other schedulers may POST.
export const GET = runMaintenance;
export const POST = runMaintenance;
