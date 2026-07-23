import "server-only";

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface RecordAuditLogInput {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

// Insert-only: no update/delete function is exposed. This is the practical
// meaning of "append-only" at the application layer — true DB-level
// immutability (triggers/permissions) is a documented future hardening step,
// see SECURITY.md. Callers must never pass passwords, tokens, session
// cookies or secret URLs in previousValue/newValue/metadata.
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      previousValue: input.previousValue ?? undefined,
      newValue: input.newValue ?? undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      correlationId: input.correlationId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}

export interface ListAuditLogsInput {
  entityType?: string;
  entityId?: string;
  take?: number;
}

export async function listAuditLogs(input: ListAuditLogsInput = {}) {
  return prisma.auditLog.findMany({
    where: {
      entityType: input.entityType,
      entityId: input.entityId,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 100,
  });
}
