"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ArcaEnvironment, FiscalTaxCategory, IssuerVatCondition } from "@/generated/prisma/client";
import { displayToMinorUnits, InvalidMoneyInputError } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import { probeArcaConnection } from "@/modules/fiscal-documents/arca/connection-probe-core";
import { isValidArcaPointOfSale } from "@/modules/fiscal-documents/arca/point-of-sale-core";
import { updateBranch } from "@/modules/store-branches/branch";
import { updateStoreConfiguration } from "@/modules/store-settings/service";

const updateStoreSettingsSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  currency: z.string().min(1).max(10),
  locale: z.string().min(1),
  timezone: z.string().min(1),
});

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

export async function updateStoreSettingsAction(input: UpdateStoreSettingsInput) {
  // Never trust the client: re-validate and re-authorize here even though
  // the form only renders for users the page already gated.
  const user = await requirePermission("settings.manage");
  const data = updateStoreSettingsSchema.parse(input);

  await updateStoreConfiguration(data, user.id);
  revalidatePath("/admin/settings");
}

// Phase — Online Orders & Checkout foundation. A blank fee disables home
// delivery entirely (checkout only offers PICKUP) — see this phase's
// documented "never invent a shipping price" policy and
// modules/orders/order-core.ts's listAvailableDeliveryMethods.
const updateDeliverySettingsSchema = z.object({
  homeDeliveryFlatFeeAmount: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value || !value.trim()) return null;
      try {
        return displayToMinorUnits(value);
      } catch (error) {
        if (error instanceof InvalidMoneyInputError) {
          ctx.addIssue({ code: "custom", message: "Monto inválido" });
          return z.NEVER;
        }
        throw error;
      }
    }),
  pickupInstructions: z.string().optional(),
});

export type UpdateDeliverySettingsInput = z.input<typeof updateDeliverySettingsSchema>;

export async function updateDeliverySettingsAction(input: UpdateDeliverySettingsInput) {
  const user = await requirePermission("settings.manage");
  const data = updateDeliverySettingsSchema.parse(input);

  await updateStoreConfiguration(
    {
      homeDeliveryFlatFeeAmount: data.homeDeliveryFlatFeeAmount,
      pickupInstructions: data.pickupInstructions?.trim() || null,
    },
    user.id,
  );
  revalidatePath("/admin/settings");
  // Delivery-method availability affects the live checkout flow.
  revalidatePath("/checkout");
}

// Phase — Public Footer Redesign. Every field optional/blank-clearable —
// a blank phone/WhatsApp/email simply hides that line in the footer's
// "Contacto" block (see components/layout/public-footer.tsx), never a
// required field.
const updateContactSettingsSchema = z.object({
  publicPhone: z.string().optional(),
  whatsappPhone: z.string().optional(),
  publicEmail: z
    .string()
    .optional()
    .refine((value) => !value || z.email().safeParse(value).success, "Email inválido"),
});

export type UpdateContactSettingsInput = z.input<typeof updateContactSettingsSchema>;

export async function updateContactSettingsAction(input: UpdateContactSettingsInput) {
  const user = await requirePermission("settings.manage");
  const data = updateContactSettingsSchema.parse(input);

  await updateStoreConfiguration(
    {
      publicPhone: data.publicPhone?.trim() || null,
      whatsappPhone: data.whatsappPhone?.trim() || null,
      publicEmail: data.publicEmail?.trim() || null,
    },
    user.id,
  );
  revalidatePath("/admin/settings");
  // The footer (and its contact block) renders on every public page via
  // the shared (public) layout — revalidating that layout once covers all
  // of them, never a per-route list to keep in sync by hand.
  revalidatePath("/", "layout");
}

// Every social field optional/blank-clearable — a blank URL hides that
// icon entirely (see components/layout/public-footer.tsx) rather than
// rendering a dead href="#" link. z.url() rejects anything that isn't a
// well-formed, safe URL (never javascript:, never a bare string).
const urlOrBlank = z
  .string()
  .optional()
  .refine((value) => !value || z.url().safeParse(value).success, "URL inválida");

const updateSocialSettingsSchema = z.object({
  instagramUrl: urlOrBlank,
  facebookUrl: urlOrBlank,
  tiktokUrl: urlOrBlank,
});

export type UpdateSocialSettingsInput = z.input<typeof updateSocialSettingsSchema>;

export async function updateSocialSettingsAction(input: UpdateSocialSettingsInput) {
  const user = await requirePermission("settings.manage");
  const data = updateSocialSettingsSchema.parse(input);

  await updateStoreConfiguration(
    {
      instagramUrl: data.instagramUrl?.trim() || null,
      facebookUrl: data.facebookUrl?.trim() || null,
      tiktokUrl: data.tiktokUrl?.trim() || null,
    },
    user.id,
  );
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
}

const updateBranchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "El nombre es obligatorio"),
  address: z.string().min(1, "La dirección es obligatoria"),
  city: z.string().min(1, "La ciudad es obligatoria"),
  province: z.string().optional(),
});

export type UpdateBranchSettingsInput = z.infer<typeof updateBranchSchema>;

export async function updateBranchAction(input: UpdateBranchSettingsInput) {
  const user = await requirePermission("settings.manage");
  const data = updateBranchSchema.parse(input);

  await updateBranch(
    data.id,
    { name: data.name, address: data.address, city: data.city, province: data.province || null },
    user.id,
  );
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
}

// Phase — Fiscal Invoicing Foundation / ARCA Fiscal Readiness + Tax Model.
// Every field optional/blank-clearable — pure preparation, never required,
// never invented; checkout/storefront never depends on any of these.
// fiscalDefaultPointOfSale pre-fills (but never forces) the "Punto de
// venta" field on the MANUAL invoice registration form — see
// RegisterInvoiceDialog. arcaPointOfSale is a SEPARATE field (never reused
// from fiscalDefaultPointOfSale — see this phase's explicit "never
// implicitly reuse a manual point-of-sale number for electronic issuance"
// rule) — validated 1-9999, ARCA's own PtoVta numeric range.
const updateFiscalSettingsSchema = z.object({
  fiscalLegalName: z.string().optional(),
  fiscalTaxId: z.string().optional(),
  fiscalDefaultPointOfSale: z.string().optional(),
  issuerVatCondition: z.enum(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO", ""]).optional(),
  fiscalAddress: z.string().optional(),
  fiscalActivityStartDate: z.string().optional(),
  fiscalGrossIncomeId: z.string().optional(),
  arcaPointOfSale: z
    .string()
    .optional()
    .refine((value) => !value || (/^\d+$/.test(value) && isValidArcaPointOfSale(Number(value))), {
      message: "El punto de venta debe ser un número entre 1 y 99998 (WSFEv1 admite hasta 5 dígitos).",
    }),
  arcaEnvironment: z.enum(["HOMOLOGATION", "PRODUCTION", ""]).optional(),
  // Phase — ARCA Fiscal Readiness correction pass. A convenience default
  // only — never accounting advice; see this field's own schema comment.
  defaultTaxCategory: z
    .enum(["IVA_21", "IVA_10_5", "IVA_27", "IVA_5", "IVA_2_5", "IVA_0", "EXENTO", ""])
    .optional(),
});

export type UpdateFiscalSettingsInput = z.input<typeof updateFiscalSettingsSchema>;

export async function updateFiscalSettingsAction(input: UpdateFiscalSettingsInput) {
  const user = await requirePermission("settings.manage");
  const data = updateFiscalSettingsSchema.parse(input);

  await updateStoreConfiguration(
    {
      fiscalLegalName: data.fiscalLegalName?.trim() || null,
      fiscalTaxId: data.fiscalTaxId?.trim() || null,
      fiscalDefaultPointOfSale: data.fiscalDefaultPointOfSale?.trim() || null,
      issuerVatCondition: (data.issuerVatCondition || null) as IssuerVatCondition | null,
      fiscalAddress: data.fiscalAddress?.trim() || null,
      fiscalActivityStartDate: data.fiscalActivityStartDate
        ? new Date(`${data.fiscalActivityStartDate}T00:00:00`)
        : null,
      fiscalGrossIncomeId: data.fiscalGrossIncomeId?.trim() || null,
      arcaPointOfSale: data.arcaPointOfSale ? Number(data.arcaPointOfSale) : null,
      arcaEnvironment: (data.arcaEnvironment || null) as ArcaEnvironment | null,
      defaultTaxCategory: (data.defaultTaxCategory || null) as FiscalTaxCategory | null,
    },
    user.id,
  );
  revalidatePath("/admin/settings");
}

// =============================================================================
// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration.
// =============================================================================

export interface TestArcaConnectionResult {
  appServer: string;
  dbServer: string;
  authServer: string;
  pointOfSale: number;
  lastAuthorizedVoucherFacturaC: number;
}

// Read-only probe (WSAA login + WSFEv1 Dummy/FECompUltimoAutorizado) —
// NEVER creates a FiscalDocument or requests a CAE. See this phase's
// explicit "Probar conexión con ARCA" requirement. Errors are surfaced
// verbatim (ArcaConnectionNotReadyError/WsaaFaultError/WsfeFaultError/
// WsfeNetworkError messages are already safe, specific Spanish text — see
// each class's own constructor) — never a raw stack trace to the client.
export async function testArcaConnectionAction(): Promise<TestArcaConnectionResult> {
  await requirePermission("settings.manage");

  try {
    const result = await probeArcaConnection();
    return {
      appServer: result.dummy.appServer,
      dbServer: result.dummy.dbServer,
      authServer: result.dummy.authServer,
      pointOfSale: result.pointOfSale,
      lastAuthorizedVoucherFacturaC: result.lastAuthorizedVoucherFacturaC,
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "No pudimos probar la conexión con ARCA.");
  }
}
