import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { REQUIRED_MIGRATION } from "@/lib/release";
import { APPLICATION_TABLE_NAMES } from "@/lib/application-tables";

export async function getProductionReadiness() {
  const [
    config,
    warehouse,
    system,
    administrator,
    migrations,
    failedEmails,
    pendingEmails,
    tables,
  ] = await Promise.all([
    prisma.storeConfiguration.findUnique({ where: { id: "main" } }),
    prisma.warehouse.count({ where: { isDefault: true, isActive: true } }),
    prisma.user.count({ where: { isSystemAccount: true, isActive: true } }),
    prisma.user.count({
      where: {
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { key: "ADMIN", isActive: true, deletedAt: null } } },
      },
    }),
    prisma.$queryRaw<
      Array<{ migration_name: string }>
    >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND migration_name = ${REQUIRED_MIGRATION}`,
    prisma.emailOutbox.count({ where: { status: "FAILED" } }),
    prisma.emailOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.$queryRaw<
      Array<{ tablename: string; rowsecurity: boolean }>
    >`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`,
  ]);
  const checks = [
    { label: "Migraciones de esta versión", ready: migrations.length > 0 },
    {
      label: "Tablas protegidas contra acceso directo",
      ready: APPLICATION_TABLE_NAMES.every((name) =>
        tables.some((table) => table.tablename === name && table.rowsecurity),
      ),
    },
    { label: "Depósito predeterminado y cuenta de sistema", ready: warehouse > 0 && system > 0 },
    { label: "Administrador activo", ready: administrator > 0 },
    { label: "Titular y CUIT", ready: Boolean(config?.fiscalLegalName && config?.fiscalTaxId) },
    { label: "Correo comercial de atención", ready: Boolean(config?.publicEmail) },
    { label: "WhatsApp de atención", ready: Boolean(config?.whatsappPhone) },
    { label: "Clave persistente de cifrado", ready: Boolean(env.DATA_ENCRYPTION_KEY) },
    {
      label: "Protección de tareas programadas",
      ready: Boolean(env.CRON_SECRET || env.INTERNAL_TASK_SECRET),
    },
    {
      label: "Mercado Pago de producción y firma de notificaciones",
      ready: Boolean(
        env.MERCADO_PAGO_ACCESS_TOKEN &&
        env.MERCADO_PAGO_WEBHOOK_SECRET &&
        env.MERCADO_PAGO_ENVIRONMENT === "PRODUCTION",
      ),
    },
    {
      label: "Correo con proveedor externo",
      ready:
        !["localhost", "127.0.0.1"].includes(env.SMTP_HOST) && !env.EMAIL_FROM.endsWith(".local"),
    },
    {
      label: "Archivos de productos en almacenamiento persistente",
      ready: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
    },
    {
      label: "Dominio HTTPS y autenticación en el mismo sitio",
      ready:
        env.NEXT_PUBLIC_APP_URL.startsWith("https://") &&
        new URL(env.BETTER_AUTH_URL).origin === new URL(env.NEXT_PUBLIC_APP_URL).origin,
    },
    { label: "Proveedores de prueba deshabilitados", ready: !env.E2E_TEST_MODE },
    { label: "Sin correos agotados por errores de entrega", ready: failedEmails === 0 },
  ];
  return { checks, failedEmails, pendingEmails, ready: checks.every((check) => check.ready) };
}
