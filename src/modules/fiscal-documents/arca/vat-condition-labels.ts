// Pure constants — no "server-only", no DB import. Same "never expose a raw
// enum value in the UI" posture as fiscal-documents/labels.ts.
import type { ArcaEnvironment, IssuerVatCondition, RecipientVatCondition } from "@/generated/prisma/client";

export const ISSUER_VAT_CONDITION_LABELS_ES: Record<IssuerVatCondition, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
};

export const RECIPIENT_VAT_CONDITION_LABELS_ES: Record<RecipientVatCondition, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  IVA_NO_ALCANZADO: "IVA No Alcanzado",
};

export const ARCA_ENVIRONMENT_LABELS_ES: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: "ARCA — Homologación",
  PRODUCTION: "ARCA — Producción",
};
