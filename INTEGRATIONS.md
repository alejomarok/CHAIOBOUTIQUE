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

## Email — SMTP o Resend y cola persistente

Recuperación, verificación y la cola de pedidos comparten el proveedor seleccionado con
`EMAIL_PROVIDER=smtp|resend`. SMTP usa Mailpit localmente o un relay real con TLS.
Resend usa `RESEND_API_KEY` y un `EMAIL_FROM` de un dominio verificado; no admite Gmail
como remitente. `EMAIL_REPLY_TO` permite indicar el correo de atención.
El modo temporal `RESEND_TEST_RECIPIENT` restringe los envíos al dueño de la cuenta de Resend:
no habilita correos a clientes y debe retirarse al verificar un dominio propio.
La salud protegida admite `?email=1` para consultar configuración sin exponer claves.

`modules/email/outbox-core.ts` registra confirmaciones de pedido/pago, cambios de entrega,
ajustes financieros y solicitudes en la misma transacción de negocio. El texto se cifra,
los eventos se deduplican y el mantenimiento retoma fallos y bloqueos caducados. Configuración
→ Preparación para publicar muestra mensajes agotados y permite reintentarlos con permiso.
El envío puede repetirse tras un corte de proceso; Message-ID estable permite identificarlo.
Ver [operación y aceptación del correo](./docs/production-release.md).

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

## Payments — Mercado Pago Checkout Pro (implemented, fake-provider tested)

**Status: implemented.** `src/modules/payments/mercado-pago/` behind a provider interface
(`MercadoPagoClient` in `types.ts`) exactly like Storage above — business logic never touches the
`mercadopago` SDK directly:

```ts
interface MercadoPagoClient {
  createPreference(input: CreateProviderPreferenceInput): Promise<ProviderPreference>;
  getPayment(providerPaymentId: string): Promise<ProviderPayment | null>;
}
```

`RealMercadoPagoClient` (`client-core.ts`) wraps the real `mercadopago` npm SDK.
`FakeMercadoPagoClient` (`fake-client-core.ts`) is a deterministic, in-memory, no-network
implementation — the ONLY provider automated tests (`npm run test`/`test:integration`/`test:e2e`)
ever exercise; `getMercadoPagoClient()` selects it automatically whenever `E2E_TEST_MODE=true`
(set only by `playwright.config.ts`'s e2e webServer), regardless of whether real credentials
happen to be configured. **A real Mercado Pago TEST Checkout Pro payment has never been validated
against this codebase** as of this phase — see this phase's own final report for exactly what
was and wasn't verified, and re-run that acceptance whenever real TEST credentials become
available.

### Environment variables

Exactly four, all read via `src/lib/env-core.ts` and resolved together by
`modules/payments/mercado-pago/config-core.ts`'s `getMercadoPagoConfig()` (all-or-nothing: a
partial config — e.g. an access token with no webhook secret — is treated as fully unconfigured,
never partially trusted):

- `MERCADO_PAGO_ACCESS_TOKEN` — server-only, never `NEXT_PUBLIC_`, never logged.
- `MERCADO_PAGO_WEBHOOK_SECRET` — server-only, used only to verify inbound webhook signatures.
- `MERCADO_PAGO_ENVIRONMENT` — exactly `"TEST"` or `"PRODUCTION"`, required alongside the token.
  Never sniffed from the token's own shape (Mercado Pago doesn't guarantee a stable prefix
  convention) — this is what selects `sandbox_init_point` vs. `init_point` on preference creation,
  and what the admin readiness card's environment label reflects.
- `MERCADO_PAGO_PUBLIC_BASE_URL` — optional, falls back to `NEXT_PUBLIC_APP_URL` when unset. See
  "Public HTTPS development URL" below.

All four are optional at the schema level (the app must boot and every unrelated feature must keep
working with none of them set) — `isMercadoPagoConfigured()` gates the public "Pagar con Mercado
Pago" button and the webhook route's own 404, and `getMercadoPagoReadiness()` powers the
Configuración → Integraciones → Mercado Pago admin card (booleans/labels only, **never** an actual
credential value, in the UI or in any log line).

### Public HTTPS development URL

Mercado Pago's servers (both preference `back_urls` redirects and the `notification_url` webhook)
must be able to reach this app over the public internet — `http://localhost:3000` is not
reachable from Mercado Pago's side. `MERCADO_PAGO_PUBLIC_BASE_URL` exists exactly for this: point
it at an HTTPS tunnel (ngrok, Cloudflare Tunnel, or equivalent) while manually testing a real
sandbox payment, and leave it unset otherwise. No specific tunnel URL is hard-coded anywhere in
this codebase — you supply your own each time you tunnel, in `.env`, never committed. The browser
itself keeps browsing `http://localhost:3000` as normal; only the URLs _given to Mercado Pago_
(back_urls, notification_url — both built in `preference-core.ts`'s `createMercadoPagoPreference`
from `config.publicBaseUrl`) need to be the public HTTPS one.

### Webhook

Exact route: **`POST /api/webhooks/mercado-pago`** (`src/app/api/webhooks/mercado-pago/route.ts`).
Register this exact path, on your current public HTTPS base URL, as the notification URL in the
Mercado Pago TEST application's own webhook configuration — e.g.
`https://<your-tunnel-domain>/api/webhooks/mercado-pago`. `GET` is rejected (405); only `POST` is
accepted. The route itself already constructs and sends this same URL on every preference it
creates (`notificationUrl` in `createMercadoPagoPreference`), so manually registering it in the
Mercado Pago dashboard is only needed for notification types Checkout Pro doesn't attach
automatically per-preference — check your Mercado Pago application's own webhook settings if
notifications aren't arriving.

Never trusts the notification body — only the signature-covered query string (`data.id`, `type`)
selects what to look up, and the actual payment state is always re-fetched server-to-server
(`reconcileMercadoPagoPayment` in `reconcile-core.ts`) before anything is written. Fails closed at
every step: 404 if Mercado Pago isn't configured at all, 401 on an invalid/missing/malformed
signature (verified via the SDK's own `WebhookSignatureValidator`, never weakened for local
development), 400 on a structurally incomplete notification, 500 (triggering Mercado Pago's own
retry) on a transient reconciliation failure — never a silent 200 on a real failure.

### Reservation expiration scheduler

GET y POST `/api/internal/expire-stale-orders` comparten el mantenimiento protegido.
La autenticación es bearer con comparación constante de `CRON_SECRET` (Vercel) o
`INTERNAL_TASK_SECRET` (programador externo); sin secreto configurado se deniega la llamada.

Vercel Hobby es el plan confirmado. `vercel.json` no programa una frecuencia incompatible. La tarea de cinco minutos se prepara con `scripts/setup-supabase-maintenance.ts` en Supabase Cron, usa `pg_net` para llamar al POST protegido y conserva el bearer en Vault. Queda desactivada por defecto; activarla solo después de verificar la versión publicada. Revisar tanto los registros del job como la respuesta HTTP. Ver [la guía operativa](./docs/production-release.md).

El mantenimiento libera reservas vencidas, entrega correos pendientes y limpia contadores
caducados y contenido de notificaciones antiguas. `/api/health` con el mismo bearer revisa
base y fallos de entrega; el acceso público solo informa disponibilidad del proceso.

Non-negotiable rules, unchanged from before this phase: payment confirmation is always re-verified
server-side against Mercado Pago's API, never trusted from a browser redirect or client-side
status (see `order/[token]/payment/return/page.tsx`'s own "hint is never proof of payment"
posture); webhook processing is idempotent (`OrderPaymentAttempt.providerPaymentId`'s own
`@unique` plus the `Order` row lock inside `finalizePaidOrder` — a webhook delivered twice must
not double-apply); Mercado Pago fees are not currently modeled as a separate line item (unchanged
scope); no card data is ever stored (Checkout Pro is a redirect flow — this app never collects
card details itself). Internal payment methods (bank transfer, cash, store pickup, POS split
payments) remain modeled independently, as plain `SalePayment` records.

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

## Electronic invoicing — ARCA en homologación; registro fiscal manual/externo

Se implementaron datos fiscales, certificado, autenticación WSAA y WSFE de homologación.
Las firmas usan Node WebCrypto y PKIjs. La emisión automática fiscal de producción está
bloqueada: no usar resultados de homologación como facturas válidas.

Para el lanzamiento, emitir comprobantes con un sistema habilitado y registrarlos en cada
venta mediante Manual/Sistema externo. El responsable contable debe completar identidad,
CUIT, condición fiscal y punto de venta, y gestionar las notas de crédito que correspondan.

## Hosting — Vercel + Supabase

Destino confirmado: Vercel para Next.js y Supabase para Postgres/Storage. Configuración de
compilación y cron en `vercel.json`; controles locales/CI en `.github/workflows/verify.yml`.
No se publicó un despliegue ni se aprovisionaron cuentas en esta tarea. Separar previews y
producción, y seguir [la guía de publicación](./docs/production-release.md) para secretos,
migraciones, aceptación comercial, respaldos y recuperación.
