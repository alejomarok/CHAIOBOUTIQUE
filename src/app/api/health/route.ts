import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInternalTaskAuthorized } from "@/lib/internal-task-auth";

export async function GET(request: Request) {
  if (!isInternalTaskAuthorized(request))
    return NextResponse.json({ status: "up" }, { headers: { "Cache-Control": "no-store" } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    const failedEmails = await prisma.emailOutbox.count({ where: { status: "FAILED" } });
    return NextResponse.json(
      { status: failedEmails ? "degraded" : "ready", failedEmails },
      { status: failedEmails ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
