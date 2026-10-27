import type { Instrumentation } from "next";
import { REQUIRED_MIGRATION } from "@/lib/release";

const EXPECTED_LATEST_MIGRATION = REQUIRED_MIGRATION;

type ErrorWithMetadata = Error & {
  code?: unknown;
  digest?: unknown;
};

function redactSensitiveText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1<redacted>@")
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, "sb_secret_<redacted>")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer <redacted>");
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: redactSensitiveText(String(error)) };
  }

  const metadata = error as ErrorWithMetadata;
  return {
    name: error.name,
    message: redactSensitiveText(error.message),
    code: metadata.code === undefined ? undefined : String(metadata.code),
    digest: metadata.digest === undefined ? undefined : String(metadata.digest),
    stack: error.stack ? redactSensitiveText(error.stack) : undefined,
  };
}

function describeUrl(name: string, rawValue: string) {
  const parsed = new URL(rawValue);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`${name} must use the postgresql:// protocol.`);
  }

  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, "") || "<missing>",
  };
}

async function runStartupDiagnostics() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const startedAt = Date.now();
    const { env } = await import("@/lib/env-core");

    const database = describeUrl("DATABASE_URL", env.DATABASE_URL);
    const directDatabase = describeUrl("DIRECT_URL", env.DIRECT_URL);

    if (env.NODE_ENV === "production" && database.port !== "6543") {
      console.warn(
        `[startup] DATABASE_URL uses port ${database.port}; this project expects Supabase's ` +
          "Transaction pooler on port 6543 in production.",
      );
    }
    if (env.NODE_ENV === "production" && directDatabase.port !== "5432") {
      console.warn(
        `[startup] DIRECT_URL uses port ${directDatabase.port}; Prisma migrations normally use ` +
          "a direct or Session pooler connection on port 5432.",
      );
    }

    console.info("[startup] Environment validation passed.", {
      nodeEnv: env.NODE_ENV,
      appHost: new URL(env.NEXT_PUBLIC_APP_URL).host,
      authHost: new URL(env.BETTER_AUTH_URL).host,
      database,
      directDatabase,
      storageConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
      smtpAuthenticationConfigured: Boolean(env.SMTP_USER && env.SMTP_PASSWORD),
      mercadoPagoConfigured: Boolean(
        env.MERCADO_PAGO_ACCESS_TOKEN &&
        env.MERCADO_PAGO_WEBHOOK_SECRET &&
        env.MERCADO_PAGO_ENVIRONMENT,
      ),
      arcaCertificateConfigured: Boolean(env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH),
      internalTaskConfigured: Boolean(env.CRON_SECRET || env.INTERNAL_TASK_SECRET),
    });

    const { prisma } = await import("@/lib/db-core");

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : undefined;
      const isLocalDatabase = database.host === "localhost" || database.host === "127.0.0.1";

      if (isLocalDatabase && code === "ECONNREFUSED") {
        throw new Error(
          `Local PostgreSQL is not reachable at ${database.host}:${database.port}. ` +
            "Start Docker Desktop, run npm run db:dev:up, then retry npm run dev.",
        );
      }

      throw error;
    }
    console.info("[startup] PostgreSQL connection passed.", {
      host: database.host,
      port: database.port,
      database: database.database,
    });

    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE migration_name = ${EXPECTED_LATEST_MIGRATION}
    LIMIT 1
  `;

    const latestMigration = migrations[0];
    if (!latestMigration || !latestMigration.finished_at || latestMigration.rolled_back_at) {
      throw new Error(
        `Expected migration ${EXPECTED_LATEST_MIGRATION} is not successfully applied. ` +
          "Run npm run prisma:migrate:deploy against the production database.",
      );
    }

    console.info("[startup] Database migration validation passed.", {
      latestMigration: EXPECTED_LATEST_MIGRATION,
    });
    console.info(`[startup] CHAIOBOUTIQUE is ready in ${Date.now() - startedAt}ms.`);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Next can load instrumentation while producing the build. Connectivity is
    // a runtime concern and must not make an otherwise valid build depend on a
    // live database. The same checks run when the deployed Node process starts.
    if (process.env.NEXT_PHASE === "phase-production-build") return;

    if (process.env.NODE_ENV !== "production") {
      const { getMercadoPagoDiagnosticLabel } =
        await import("@/modules/payments/mercado-pago/config-core");
      const label = getMercadoPagoDiagnosticLabel();
      const border = "=".repeat(Math.max(label.length + 4, 48));
      console.log(["", border, `  ${label}`, border, ""].join("\n"));
    }

    try {
      await runStartupDiagnostics();
    } catch (error) {
      console.error("[startup] CHAIOBOUTIQUE failed its startup validation.", describeError(error));
      throw new Error("CHAIOBOUTIQUE startup validation failed. Check the preceding server log.");
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  console.error("[server-error] Next.js captured a server request error.", {
    ...describeError(error),
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
  });
};
