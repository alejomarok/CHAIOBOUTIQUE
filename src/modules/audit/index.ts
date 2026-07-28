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
// meaning of "append-only" at the application layer — the migration that
// introduces inventory_movement also adds a DB-level append-only trigger to
// audit_log itself (see DATABASE.md). Callers must never pass passwords,
// tokens, session cookies or secret URLs in previousValue/newValue/metadata.
//
// `client` accepts an open Prisma transaction client and defaults to the
// plain global `prisma` client — every Phase 1 call site is unaffected.
// Inventory operations (modules/inventory/service.ts) pass their own `tx` so
// the audit record commits atomically with the balance/movement change it
// describes — see ARCHITECTURE.md for why that's a scoped exception to the
// after-commit pattern used elsewhere (roles/store-settings).
export async function recordAuditLog(
  input: RecordAuditLogInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await client.auditLog.create({
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
