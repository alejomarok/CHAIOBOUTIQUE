// Runs once when a new Next.js server instance starts (stable since Next
// 15 — see node_modules/next/dist/docs/.../instrumentation.md), before any
// request is handled. Used here for exactly one thing: a prominent,
// grep-able "Mercado Pago: TEST" / "Mercado Pago: PRODUCTION" / "Mercado
// Pago: no configurado" startup line — see this integration's explicit
// "Clearly distinguish TEST from PRODUCTION configuration" requirement,
// same "impossible to scroll past unnoticed" posture as src/lib/db-core.ts's
// own "DATABASE: LOCAL DEVELOPMENT / REMOTE SUPABASE" banner (left
// unchanged — that banner already has its own, different one-time-per-
// process trigger tied to the Prisma client singleton; this file is a
// separate, purpose-built hook rather than coupling an unrelated feature
// module into db-core.ts). Never logs the access token or webhook secret —
// see getMercadoPagoDiagnosticLabel's own comment.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;

  const { getMercadoPagoDiagnosticLabel } = await import("@/modules/payments/mercado-pago");
  const label = getMercadoPagoDiagnosticLabel();
  const border = "=".repeat(Math.max(label.length + 4, 48));
  console.log(["", border, `  ${label}`, border, ""].join("\n"));
}
