import "dotenv/config";
import { prisma } from "../src/lib/db-core";
import { getProductionReadiness } from "../src/modules/production/readiness-core";

async function main() {
  try {
    const report = await getProductionReadiness();
    for (const check of report.checks)
      console.log(`${check.ready ? "OK" : "PENDIENTE"}: ${check.label}`);
    console.log(`Correos pendientes: ${report.pendingEmails}; fallidos: ${report.failedEmails}.`);
    console.log(
      "Verificar externamente: cron, compra y devolución reales, correo recibido, facturación y restauración de backups.",
    );
    if (!report.ready) process.exitCode = 1;
  } catch {
    console.error(
      "No se pudo verificar la preparación. Revisá conexión y migraciones; no se modificaron datos.",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
void main();
