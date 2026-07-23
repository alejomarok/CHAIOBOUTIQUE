# External Integrations

Every external integration lives behind a provider interface so business logic never depends
directly on a specific vendor's SDK/API shape. This document lists what's implemented vs.
documented-only this phase, and the interface each future integration must implement.

## Storage — Supabase Storage (interface + implementation built, not wired to any UI)

**Status: implemented, unused.** `src/modules/storage/`:

```ts
interface StorageProvider {
  upload(input: UploadInput): Promise<StoredObject>;
  getSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  delete(bucket: string, path: string): Promise<void>;
}
```

`SupabaseStorageProvider` implements it via `@supabase/supabase-js` with the service role key
(server-only). `validateUpload()`/`buildObjectPath()` (unit-tested) enforce a MIME allowlist,
extension-vs-MIME cross-check, size limit, and a generated path scoped to
`entityType/entityId/` (prevents path traversal). The application database is meant to store
only metadata (bucket, path, MIME, size) — never binary content.

No upload UI exists yet because no entity (product, supplier document) exists to attach a file
to. Wire this in when the catalog (product images) or purchasing (supplier invoices) modules are
built. Private buckets by default; a public/optimized bucket is reserved for future
customer-facing product images.

## Email — Mailpit (dev) implemented; Resend (production) deferred

**Status: dev implementation only.** `src/modules/email/`:

```ts
interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}
```

`SmtpEmailProvider` (nodemailer, SMTP) is the only implementation, pointed at Mailpit
(`SMTP_HOST=localhost`, `SMTP_PORT=1025`) in dev — currently used for the password-reset flow
(`sendPasswordResetEmail` in `src/modules/email/index.ts`, called from Better Auth's
`sendResetPassword` config).

**To go to production**: implement a `ResendEmailProvider` against the `resend` package (not
installed yet — deliberately, since there's no API key to configure), read `RESEND_API_KEY` from
env, and swap it in via `getEmailProvider()`. Future notification types (order confirmation,
shipment, low-stock alerts, etc. — see the original requirements) all go through this same
interface once their triggering modules exist.

## Payments — Mercado Pago (documented only, not implemented)

**Status: not built.** No `payments` module exists yet — it's created alongside the
sales/checkout phase (see [ROADMAP.md](./ROADMAP.md)). When it is, it must implement a provider
interface along these lines:

```ts
interface PaymentProvider {
  createPreference(input: CreatePreferenceInput): Promise<PaymentPreference>;
  handleWebhook(request: Request): Promise<WebhookResult>; // idempotent
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>; // server-verified, never trust the browser
  refund(paymentId: string, amountMinorUnits?: number): Promise<RefundResult>; // partial refund optional
}
```

Non-negotiable rules for that future implementation: payment confirmation is always re-verified
server-side against Mercado Pago's API, never trusted from a browser redirect or client-side
status; webhook processing is idempotent (a webhook delivered twice must not double-apply);
Mercado Pago fees are recorded as their own line item, not netted silently into revenue; no card
data is ever stored. Internal payment methods (bank transfer, cash, store pickup, POS split
payments) are modeled independently of this interface, as plain payment records.

## Shipping — Andreani (documented only, not implemented)

**Status: not built.** Future `ShippingProvider` interface (as specified in the original
requirements, reproduced here so it isn't reinvented differently later):

```ts
interface ShippingProvider {
  quote(input: ShippingQuoteInput): Promise<ShippingQuote[]>;
  createShipment(input: CreateShipmentInput): Promise<ShipmentResult>;
  getLabel(shipmentId: string): Promise<Buffer>;
  getTracking(trackingNumber: string): Promise<TrackingEvent[]>;
  cancelShipment(shipmentId: string): Promise<void>;
}
```

`AndreaniShippingProvider` implements it once real API docs/credentials exist — no Andreani
endpoint is invented ahead of that. A mock provider (store pickup / local delivery) is the first
concrete implementation when the shipping module is built, so the interface is exercised without
needing real credentials. Additional providers (Correo Argentino, OCA, Envíopack) implement the
same interface later.

## Electronic invoicing — ARCA (documented only, not implemented)

**Status: not built, and deliberately not scoped into `StoreConfiguration` yet.** Fiscal data
(CAE, points of sale, invoice types/numbering, homologation vs. production environment,
certificates) is real regulatory surface area — it gets its own reviewed data model before any
code is written, per the standing rule against adding vague fiscal placeholder fields early.
When that review happens, business rules must be built behind an invoicing provider abstraction
(fiscal authorization, PDF generation, credit/debit notes, retry handling) so they aren't
directly coupled to ARCA's web service details, and any pre-production work must use an
explicitly labeled homologation/sandbox implementation — never a fake/simulated authorization.

## Hosting — Vercel + Supabase (planned, not configured)

Planned target: Vercel for the Next.js app, Supabase for Postgres + Storage. Not configured in
this phase per the original scope ("do not configure production deployment unless explicitly
requested"). When it is: `DATABASE_URL`/`DIRECT_URL` come from the Supabase project's connection
pooler settings (see [DATABASE.md](./DATABASE.md)), all server secrets go into Vercel's
environment variable settings (never in the repo), and preview deployments should point at a
non-production database or a branched Supabase environment, not the same `DATABASE_URL` as
production.
