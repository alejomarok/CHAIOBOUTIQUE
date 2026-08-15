"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { displayToMinorUnits, InvalidMoneyInputError, serializeMoney } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import {
  cancelSale,
  confirmSale,
  createSale,
  getAvailableStockForVariants,
  InsufficientSaleStockError,
  searchSellableVariants,
  updateSale,
} from "@/modules/sales/sale";

// Same moneyField pattern as app/(admin)/admin/products/actions.ts — a
// display-formatted string ("1500,50") parsed into exact BigInt minor
// units, never a float intermediate. See lib/money.ts.
const moneyField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      return displayToMinorUnits(value);
    } catch (error) {
      if (error instanceof InvalidMoneyInputError) {
        ctx.addIssue({ code: "custom", message: "Monto inválido" });
        return z.NEVER;
      }
      throw error;
    }
  });

const saleItemSchema = z.object({
  productVariantId: z.string().min(1),
  quantity: z.number().int().positive("La cantidad debe ser mayor a 0."),
  unitPriceAmount: moneyField,
  discountAmount: moneyField,
});

const saleFieldsSchema = z.object({
  customerId: z.string().min(1, "Seleccioná un cliente."),
  // Omitted: resolves server-side to the system default warehouse.
  warehouseId: z.string().optional(),
  items: z.array(saleItemSchema),
  notes: z.string().optional(),
  confirm: z.boolean().optional(),
});

// Friendly Spanish translation for the service layer's typed errors — never
// a raw internal error string reaches the client.
// InsufficientSaleStockError's own .message is ALREADY the final, detailed,
// itemized Spanish text (see modules/sales/sale-core.ts) — passed through
// verbatim, never re-wrapped.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof InsufficientSaleStockError) return error.message;
  if (error instanceof Error) {
    const knownErrors = [
      "SaleNotFoundError",
      "SaleNotEditableError",
      "SaleAlreadyCancelledError",
      "EmptySaleCannotBeConfirmedError",
      "ProductVariantNotFoundError",
      "ProductVariantMissingPriceError",
      "InvalidSaleItemError",
      "WarehouseNotFoundError",
      "NoDefaultWarehouseError",
      "InactiveWarehouseError",
      "CancellationReasonRequiredError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos guardar la venta. Intentá de nuevo.";
}

export async function createSaleAction(input: z.input<typeof saleFieldsSchema>) {
  const actor = await requirePermission("sales.create");
  const data = saleFieldsSchema.parse(input);
  // Never trust the client's own hiding of the discount field — re-checked
  // here exactly like products/actions.ts's canSetCost.
  const canApplyDiscount = actor.permissions.has("sales.apply_discount");

  try {
    const sale = await createSale(
      {
        customerId: data.customerId,
        warehouseId: data.warehouseId,
        items: data.items.map((item) => ({
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          unitPriceAmount: item.unitPriceAmount,
          discountAmount: canApplyDiscount ? item.discountAmount : null,
        })),
        notes: data.notes || null,
        confirm: data.confirm,
      },
      actor.id,
    );
    revalidatePath("/admin/sales");
    if (data.confirm) {
      // A confirmed sale changed real stock — every screen that shows it
      // must reflect the new quantity without a manual refresh.
      revalidatePath("/admin/inventory");
      revalidatePath("/admin/products");
    }
    return { id: sale.id };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}

export async function updateSaleAction(id: string, input: z.input<typeof saleFieldsSchema>) {
  const actor = await requirePermission("sales.create");
  const data = saleFieldsSchema.parse(input);
  const canApplyDiscount = actor.permissions.has("sales.apply_discount");

  try {
    await updateSale(
      id,
      {
        warehouseId: data.warehouseId,
        items: data.items.map((item) => ({
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          unitPriceAmount: item.unitPriceAmount,
          discountAmount: canApplyDiscount ? item.discountAmount : null,
        })),
        notes: data.notes || null,
        confirm: data.confirm,
      },
      actor.id,
    );
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${id}`);
  if (data.confirm) {
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/products");
  }
}

export async function confirmSaleAction(id: string) {
  const actor = await requirePermission("sales.create");
  try {
    await confirmSale(id, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${id}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
}

// reason is mandatory — see modules/sales/sale-core.ts's cancelSale.
const cancelSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1, "El motivo de cancelación es obligatorio."),
});

export async function cancelSaleAction(input: z.infer<typeof cancelSchema>) {
  const actor = await requirePermission("sales.cancel");
  const data = cancelSchema.parse(input);
  try {
    await cancelSale(data.id, data.reason, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${data.id}`);
  // A cancelled CONFIRMED sale restores stock — same revalidation need as
  // confirming one.
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
}

const searchSchema = z.object({ query: z.string(), warehouseId: z.string().min(1) });

export interface SellableVariantDTO {
  id: string;
  sku: string;
  displayName: string;
  // Serialized (see lib/money.ts) — a raw bigint can't cross this boundary.
  effectivePriceAmount: string | null;
  availableStock: number;
}

export async function searchSellableVariantsAction(
  input: z.infer<typeof searchSchema>,
): Promise<SellableVariantDTO[]> {
  await requirePermission("sales.create");
  const data = searchSchema.parse(input);
  const variants = await searchSellableVariants(data.query, data.warehouseId);
  return variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    displayName: variant.displayName,
    effectivePriceAmount:
      variant.effectivePriceAmount !== null ? serializeMoney(variant.effectivePriceAmount) : null,
    availableStock: variant.availableStock,
  }));
}

const stockQuerySchema = z.object({
  variantIds: z.array(z.string()),
  warehouseId: z.string().min(1),
});

// Lets the form re-check available stock for lines already added (from a
// search result or from an edited draft's saved items) whenever the
// selected warehouse changes — never trusted at confirmation time either
// way (see sale-core.ts's findStockShortfalls / applyInventoryOperation),
// this is display-only.
export async function getAvailableStockForVariantsAction(
  input: z.infer<typeof stockQuerySchema>,
): Promise<Record<string, number>> {
  await requirePermission("sales.create");
  const data = stockQuerySchema.parse(input);
  const stock = await getAvailableStockForVariants(data.variantIds, data.warehouseId);
  return Object.fromEntries(stock);
}
