// Pure(ish) — no DB, no fs, no network: the only external dependency is the
// caller-injected fetchTicket callback (see auth-provider-core.ts's
// RealArcaAuthProvider, which injects requestArcaAccessTicket). Kept
// strictly separate from the real signing/network code specifically so the
// genuinely tricky part — clock-skew-aware freshness + single-flight
// concurrency dedup — is unit-testable with a fake, call-counting fetcher
// instead of real crypto/network (see this phase's explicit
// "concurrency-safe ticket acquisition" requirement).
//
// MULTI-PROCESS LIMITATION (documented, not fixed this phase): this cache
// is plain in-memory state — valid only within one Node process. A
// multi-instance deployment (several server processes/containers) would
// have each instance maintain its own independent ticket, each
// independently calling WSAA's loginCms on its own cache miss. That's
// wasteful (more WSAA logins than strictly necessary) but not INCORRECT:
// WSAA does not enforce "at most one valid ticket per service" — several
// simultaneously valid tickets for the same CUIT+service, held by
// different processes, is a supported, safe outcome, never a duplicate-
// issuance risk (numbering safety is a completely separate concern — see
// issue-electronic-invoice-core.ts's own Postgres-advisory-lock strategy,
// which DOES work correctly across multiple processes since it lives in
// the database, not in a process's memory). A future multi-instance
// deployment wanting to eliminate the redundant logins would need a
// shared cache (e.g. Redis) — out of scope this phase.
import type { ArcaAuthTicket } from "./auth-provider-core";

export type ArcaTicketFetcher = () => Promise<ArcaAuthTicket>;

// How far before the ticket's own reported expiration it is treated as
// "used up" — covers clock skew between this process and ARCA's server,
// plus the time a request built with this ticket might spend in flight.
export const ARCA_TICKET_EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

function isTicketStillValid(ticket: ArcaAuthTicket, now: number): boolean {
  return ticket.expiresAt.getTime() - ARCA_TICKET_EXPIRY_SAFETY_MARGIN_MS > now;
}

interface TicketCacheState {
  ticket: ArcaAuthTicket | null;
  pending: Promise<ArcaAuthTicket> | null;
}

// A class (not bare module state) so a dedicated instance can be
// constructed per test — real callers share the single module-level
// instance exported below (arcaTicketCache), same singleton posture as
// every other provider in this directory.
export class ArcaTicketCache {
  private state: TicketCacheState = { ticket: null, pending: null };

  // Never logs Token/Sign — this function only ever returns the ticket
  // object; callers (electronic-invoice-provider-core.ts) are responsible
  // for the same discipline downstream.
  async getValidTicket(fetchTicket: ArcaTicketFetcher, now: number = Date.now()): Promise<ArcaAuthTicket> {
    if (this.state.ticket && isTicketStillValid(this.state.ticket, now)) {
      return this.state.ticket;
    }
    if (this.state.pending) {
      return this.state.pending;
    }

    const pending = (async () => {
      try {
        const ticket = await fetchTicket();
        this.state.ticket = ticket;
        return ticket;
      } finally {
        this.state.pending = null;
      }
    })();
    this.state.pending = pending;
    return pending;
  }

  resetForTesting(): void {
    this.state = { ticket: null, pending: null };
  }
}

export const arcaTicketCache = new ArcaTicketCache();
