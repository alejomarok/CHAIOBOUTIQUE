import { describe, expect, it, vi } from "vitest";

import { ArcaTicketCache } from "@/modules/fiscal-documents/arca/wsaa-ticket-cache-core";
import type { ArcaAuthTicket } from "@/modules/fiscal-documents/arca/auth-provider-core";

function makeTicket(expiresInMs: number): ArcaAuthTicket {
  return { token: "T", sign: "S", expiresAt: new Date(Date.now() + expiresInMs) };
}

describe("ArcaTicketCache", () => {
  it("fetches once and reuses the cached ticket while it is still fresh", async () => {
    const cache = new ArcaTicketCache();
    const fetchTicket = vi.fn(async () => makeTicket(60 * 60 * 1000));

    const first = await cache.getValidTicket(fetchTicket);
    const second = await cache.getValidTicket(fetchTicket);

    expect(first).toBe(second);
    expect(fetchTicket).toHaveBeenCalledTimes(1);
  });

  it("refetches once the ticket is within the clock-skew safety margin of expiring", async () => {
    const cache = new ArcaTicketCache();
    const fetchTicket = vi
      .fn()
      .mockResolvedValueOnce(makeTicket(60 * 60 * 1000))
      .mockResolvedValueOnce(makeTicket(60 * 60 * 1000));

    await cache.getValidTicket(fetchTicket);
    // 4 minutes left is inside the 5-minute safety margin — must refetch.
    await cache.getValidTicket(fetchTicket, Date.now() + 56 * 60 * 1000);

    expect(fetchTicket).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent callers into a single in-flight fetch (single-flight)", async () => {
    const cache = new ArcaTicketCache();
    let resolveFetch: (ticket: ArcaAuthTicket) => void = () => {};
    const fetchTicket = vi.fn(
      () =>
        new Promise<ArcaAuthTicket>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const callA = cache.getValidTicket(fetchTicket);
    const callB = cache.getValidTicket(fetchTicket);
    const callC = cache.getValidTicket(fetchTicket);

    expect(fetchTicket).toHaveBeenCalledTimes(1);
    resolveFetch(makeTicket(60 * 60 * 1000));

    const [a, b, c] = await Promise.all([callA, callB, callC]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchTicket).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh fetch after a failed attempt (does not cache a rejection)", async () => {
    const cache = new ArcaTicketCache();
    const fetchTicket = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(makeTicket(60 * 60 * 1000));

    await expect(cache.getValidTicket(fetchTicket)).rejects.toThrow("network down");
    const ticket = await cache.getValidTicket(fetchTicket);

    expect(ticket.token).toBe("T");
    expect(fetchTicket).toHaveBeenCalledTimes(2);
  });

  it("resetForTesting clears both the cached ticket and any in-flight fetch", async () => {
    const cache = new ArcaTicketCache();
    const fetchTicket = vi.fn(async () => makeTicket(60 * 60 * 1000));
    await cache.getValidTicket(fetchTicket);

    cache.resetForTesting();
    await cache.getValidTicket(fetchTicket);

    expect(fetchTicket).toHaveBeenCalledTimes(2);
  });
});
