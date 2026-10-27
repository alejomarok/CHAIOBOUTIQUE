import "./guard";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db-core";
import { createDatabaseRateLimiter } from "@/lib/database-rate-limit";
import {
  enqueueEmail,
  processEmailOutbox,
  setOutboxSenderForTesting,
} from "@/modules/email/outbox-core";
import {
  createConsumerRequest,
  updateConsumerRequest,
} from "@/modules/consumer-requests/service-core";

afterEach(() => {
  setOutboxSenderForTesting(null);
});
describe("shared production operations", () => {
  it("counts simultaneous requests atomically across independent limiter instances", async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createDatabaseRateLimiter(3, 60_000).check(`${key}:${index % 1}`),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(3);
    expect(results.every((result) => result.remaining >= 0)).toBe(true);
  });
  it("deduplicates encrypted messages, safely leases concurrent workers, and retries delivery failures", async () => {
    await prisma.emailOutbox.deleteMany();
    const key = randomUUID();
    const input = {
      eventKey: key,
      recipient: "outbox@test.chaioboutique.local",
      payload: { subject: "Pedido de prueba", text: "private-token-not-plaintext" },
    };
    await prisma.$transaction(async (tx) => {
      await enqueueEmail(tx, input);
      await enqueueEmail(tx, input);
    });
    const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { eventKey: key } });
    expect(row.encryptedPayload).not.toContain(input.payload.text);
    let deliveries = 0;
    setOutboxSenderForTesting(async () => {
      deliveries++;
    });
    await Promise.all([processEmailOutbox(1), processEmailOutbox(1)]);
    expect(deliveries).toBe(1);
    expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "SENT",
    );
    await prisma.$transaction((tx) => enqueueEmail(tx, { ...input, eventKey: `${key}:retry` }));
    setOutboxSenderForTesting(async () => {
      throw new Error("fake SMTP failure with confidential transport data");
    });
    await processEmailOutbox(1);
    const failed = await prisma.emailOutbox.findUniqueOrThrow({
      where: { eventKey: `${key}:retry` },
    });
    expect(failed.status).toBe("PENDING");
    expect(failed.lastErrorCode).toBe("DELIVERY_FAILED");
    expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());
    setOutboxSenderForTesting(async () => {
      deliveries++;
    });
    await prisma.emailOutbox.update({
      where: { id: failed.id },
      data: { availableAt: new Date(0) },
    });
    await processEmailOutbox(1);
    expect(deliveries).toBe(2);
  });
  it("creates a withdrawal without an account, keeps its receipt idempotent, and serializes closing responses", async () => {
    const actor = await prisma.user.findFirstOrThrow({ where: { isSystemAccount: true } });
    const input = {
      requestId: randomUUID(),
      kind: "WITHDRAWAL" as const,
      fullName: "Cliente sin cuenta",
      email: "guest@test.chaioboutique.local",
    };
    const created = await createConsumerRequest(input);
    expect((await createConsumerRequest(input)).code).toBe(created.code);
    expect(
      await prisma.emailOutbox.count({
        where: { eventKey: `consumer-request:${created.id}:receipt` },
      }),
    ).toBe(1);
    const results = await Promise.allSettled([
      updateConsumerRequest(
        { id: created.id, status: "RESOLVED", resolution: "Coordinamos el retiro sin costo." },
        actor.id,
      ),
      updateConsumerRequest(
        { id: created.id, status: "REJECTED", resolution: "Otra respuesta." },
        actor.id,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.emailOutbox.count({
        where: { eventKey: `consumer-request:${created.id}:resolution` },
      }),
    ).toBe(1);
  });
});
