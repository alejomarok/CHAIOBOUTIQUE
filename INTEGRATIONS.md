# External Integrations

Every external integration lives behind a provider interface so business logic never depends
directly on a specific vendor's SDK/API shape. This document lists what's implemented vs.
documented-only this phase, and the interface each future integration must implement.

## Storage — Supabase Storage (implemented, wired to product images)

**Status: implemented and in use.** `src/modules/storage/`:

```ts
interface StorageProvider {
  upload(input: UploadInput): Promise<StoredObject>;
  createSignedUploadUrl(bucket: string, path: string): Promise<SignedUploadTarget>;
  download(bucket: string, path: string): Promise<Buffer>;
  getSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  getPublicUrl(bucket: string, path: string): string; // synchronous
  delete(bucket: string, path: string): Promise<void>;
}
```

`SupabaseStorageProvider` implements it via `@supabase/supabase-js` with the secret key
(server-only). `validateUpload()`/`buildObjectPath()` enforce a MIME allowlist,
extension-vs-MIME cross-check, and size limit; `validateImageFileSignature()` additionally checks
the actual leading bytes of an image upload against its declared `Content-Type` — see
[SECURITY.md](./SECURITY.md#file-upload-validation-product-images). The generated path is always
scoped to `entityType/entityId/<uuid>.<ext>` (prevents path traversal; never the caller-supplied
filename). The application database stores only metadata (bucket, path, MIME, size,
width/height) — never binary content.

**Product images upload directly from the browser to Supabase Storage — the file's bytes never
pass through a Next.js Server Action** (Server Actions have a 1 MB default body limit, and the
point of a direct upload is to not depend on raising it). `modules/products/product-images.ts`
drives a two-phase flow: `prepareProductImageUpload` (auth check, product-existence check,
server-generates the object path, calls `createSignedUploadUrl` — a short-lived, path-scoped
token; no Supabase key of any kind is ever sent to the browser) → the browser PUTs the file
directly to the returned `signedUrl` → `finalizeProductImageUpload` (re-checks auth, validates the
echoed-back path matches exactly `products/{productId}/{uuid}.{ext}` via regex — a client can
never point the finalize step at another product's or another bucket's object — downloads the
object back since the server never saw the bytes in transit, then runs the same file-signature
and dimension checks the old single-step flow ran, then creates the `ProductImage` row). If DB
creation fails after a successful storage upload, the just-uploaded object is deleted so nothing
orphaned is left pointing at no DB row; if that cleanup itself fails, it's logged, not swallowed.
`deleteProductImage` (DB row deleted first, storage delete is best-effort — an orphaned storage
object is a documented, accepted gap, safer than a DB row pointing at a deleted object),
`setPrimaryImage` (exactly one primary per product, transactional). No format conversion or
resizing happens server-side — no `sharp` dependency, deliberately: as of this phase, `sharp` has
documented compatibility friction with Next.js 16 + Turbopack + Vercel's serverless bundling that
wasn't worth working around. Instead, `src/lib/image-optimize.ts` resizes/re-encodes client-side
before upload (`createImageBitmap` + `<canvas>`, no native dependency) — max long edge ~1900px,
JPEG/WebP quality 0.82, format-preserving (PNG stays PNG, so transparency is never destroyed),
20 MB hard source-file ceiling. Images are stored exactly as the browser uploaded them post
client-side optimization; `image-size` (pure JS, no native binary) validates pixel dimensions
server-side (max 6000px/side, checked against the real downloaded bytes, never a client-reported
value); `next/image` + `next.config.ts`'s `images.remotePatterns` (derived from `SUPABASE_URL` at
config-load time) handle resizing/format negotiation at render time. Revisit `sharp` if
server-side processing (thumbnails, format normalization) becomes a real requirement later.

`SUPABASE_PRODUCT_IMAGES_BUCKET` (default `product-images`) is a public bucket — product photos
are customer-facing by nature; nothing sensitive is ever stored in it.

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

## Migration imports — CSV pipeline (implemented, generic)

**Status: implemented, generic — not mapped to any specific legacy system.** `src/modules/imports/`
provides a CSV-based path for loading `Category`/`Brand`/`Product`/`ProductVariant`/initial stock
data from a prior system, at `/admin/imports/products` (`product_imports.view` to see history,
`product_imports.execute` to run one — ADMIN-only by default, see
[PERMISSIONS.md](./PERMISSIONS.md)). Not a provider interface like the others in this
document — there's no external vendor here — but documented for the same reason: so a future
integration with a specific legacy system's export format extends this pipeline instead of
reinventing one.

Design, in brief (full detail in [DATABASE.md](./DATABASE.md#migration-import-foundation-importbatch-importissue)
and [ADR-2](./docs/adr/0002-inventory-balance-projection.md)):

- Column sets are generic and documented (`modules/imports/row-schemas.ts`), not tailored to any
  particular legacy system — that mapping is added once a real sample export exists.
- No file is persisted server-side; a dry-run preview and the real execution are each a
  self-contained parse of the same in-browser file selection.
- One database transaction per row — a bad row is recorded and skipped, never rolling back rows
  already committed.
- Row-level idempotency (derived from `sourceSystem` + the row's own legacy id, not the import
  batch) makes re-uploading the same or a corrected file safe — already-applied rows are
  detected and skipped, not re-applied.
- Every generated CSV (template, error report) is run through `sanitizeCsvCell()` — see
  [SECURITY.md](./SECURITY.md#csv-injection-protection-imports).

When a real legacy system's export format is known, add its column mapping as a translation step
ahead of `modules/imports/row-schemas.ts`'s generic shape, rather than changing the generic
pipeline itself.

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
