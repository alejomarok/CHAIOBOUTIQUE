"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import {
  activateCustomer,
  addCustomerAddress,
  createCustomer,
  deactivateCustomer,
  deleteCustomerAddress,
  findLinkableUserByEmail,
  linkCustomerToUser,
  setDefaultBillingAddress,
  setDefaultShippingAddress,
  unlinkCustomerFromUser,
  updateCustomer,
  updateCustomerAddress,
} from "@/modules/customers/customer";
import { normalizeStrongIdentifier } from "@/modules/customers/normalize";

// Argentina's DNI is historically 6-8 digits; CUIT is always exactly 11
// (2-digit prefix + 8-digit body + 1 check digit). Deliberately loose (not
// a checksum validator) — this schema is not Argentina-only (see this
// phase's own instructions), so these are sanity bounds, not a claim of
// full validity. Any digit count outside this range is almost certainly a
// data-entry mistake worth catching before it's saved.
function isPlausibleDniLength(normalized: string): boolean {
  return normalized.length >= 6 && normalized.length <= 8;
}
function isPlausibleCuitLength(normalized: string): boolean {
  return normalized.length === 11;
}

const customerFieldsSchema = z
  .object({
    type: z.enum(["PERSON", "COMPANY"]),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    businessName: z.string().optional(),
    documentType: z.string().optional(),
    documentNumber: z.string().optional(),
    taxId: z.string().optional(),
    taxCondition: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PERSON" && !data.firstName?.trim()) {
      ctx.addIssue({ code: "custom", path: ["firstName"], message: "El nombre es obligatorio." });
    }
    if (data.type === "COMPANY" && !data.businessName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["businessName"],
        message: "La razón social es obligatoria.",
      });
    }
    if (data.email && !z.email().safeParse(data.email).success) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "El correo electrónico no tiene un formato válido.",
      });
    }
    if (data.documentNumber?.trim()) {
      const normalized = normalizeStrongIdentifier(data.documentNumber);
      if (!normalized || !isPlausibleDniLength(normalized)) {
        ctx.addIssue({
          code: "custom",
          path: ["documentNumber"],
          message: "El número de documento no es válido.",
        });
      }
    }
    if (data.taxId?.trim()) {
      const normalized = normalizeStrongIdentifier(data.taxId);
      if (!normalized || !isPlausibleCuitLength(normalized)) {
        ctx.addIssue({ code: "custom", path: ["taxId"], message: "El CUIT no es válido." });
      }
    }
  });

// Friendly Spanish translation for the service layer's typed errors — never
// a raw Prisma/Zod/internal error string reaches the client. See this
// phase's privacy/UX requirements.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    const knownErrors = [
      "CustomerNotFoundError",
      "SystemCustomerProtectedError",
      "DuplicateCustomerDocumentError",
      "DuplicateCustomerTaxIdError",
      "UserAlreadyLinkedError",
      "CustomerAlreadyLinkedError",
      "AddressNotFoundError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos guardar los cambios. Intentá de nuevo.";
}

export async function createCustomerAction(
  input: z.input<typeof customerFieldsSchema> & { confirmed?: boolean },
) {
  const actor = await requirePermission("customers.manage");
  const data = customerFieldsSchema.parse(input);

  try {
    const result = await createCustomer(
      {
        type: data.type,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        businessName: data.businessName || null,
        documentType: data.documentType || null,
        documentNumber: data.documentNumber || null,
        taxId: data.taxId || null,
        taxCondition: data.taxCondition || null,
        email: data.email || null,
        phone: data.phone || null,
        notes: data.notes || null,
      },
      actor.id,
      { confirmed: input.confirmed },
    );

    if (result.status === "possible_duplicates") {
      return result;
    }

    revalidatePath("/admin/customers");
    return { status: "created" as const, id: result.customer.id };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}

export async function updateCustomerAction(
  id: string,
  input: z.input<typeof customerFieldsSchema> & { confirmed?: boolean },
) {
  const actor = await requirePermission("customers.manage");
  const data = customerFieldsSchema.parse(input);

  try {
    const result = await updateCustomer(
      id,
      {
        type: data.type,
        firstName: data.firstName || null,
        lastName: data.lastName || null,
        businessName: data.businessName || null,
        documentType: data.documentType || null,
        documentNumber: data.documentNumber || null,
        taxId: data.taxId || null,
        taxCondition: data.taxCondition || null,
        email: data.email || null,
        phone: data.phone || null,
        notes: data.notes || null,
      },
      actor.id,
      { confirmed: input.confirmed },
    );

    if (result.status === "possible_duplicates") {
      return result;
    }

    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${id}`);
    return { status: "updated" as const, id: result.customer.id };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}

export async function deactivateCustomerAction(id: string) {
  const actor = await requirePermission("customers.manage");
  try {
    await deactivateCustomer(id, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${id}`);
}

export async function activateCustomerAction(id: string) {
  const actor = await requirePermission("customers.manage");
  try {
    await activateCustomer(id, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${id}`);
}

const linkAccountSchema = z.object({
  customerId: z.string().min(1),
  email: z.email("Ingresá un email válido."),
});

export async function linkCustomerToUserAction(input: z.infer<typeof linkAccountSchema>) {
  const actor = await requirePermission("customers.manage");
  const data = linkAccountSchema.parse(input);

  const user = await findLinkableUserByEmail(data.email);
  if (!user) {
    throw new Error("No encontramos ninguna cuenta con ese email.");
  }

  try {
    await linkCustomerToUser(data.customerId, user.id, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${data.customerId}`);
}

export async function unlinkCustomerFromUserAction(customerId: string) {
  const actor = await requirePermission("customers.manage");
  try {
    await unlinkCustomerFromUser(customerId, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

const addressFieldsSchema = z.object({
  label: z.string().optional(),
  street: z.string().min(1, "La calle es obligatoria."),
  number: z.string().optional(),
  floor: z.string().optional(),
  apartment: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().min(1, "La ciudad es obligatoria."),
  province: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
});

function addressPayload(data: z.infer<typeof addressFieldsSchema>) {
  return {
    label: data.label || null,
    street: data.street,
    number: data.number || null,
    floor: data.floor || null,
    apartment: data.apartment || null,
    postalCode: data.postalCode || null,
    city: data.city,
    province: data.province || null,
    country: data.country || undefined,
    notes: data.notes || null,
  };
}

export async function addCustomerAddressAction(
  customerId: string,
  input: z.input<typeof addressFieldsSchema>,
) {
  const actor = await requirePermission("customers.manage");
  const data = addressFieldsSchema.parse(input);
  try {
    await addCustomerAddress(customerId, addressPayload(data), actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function updateCustomerAddressAction(
  addressId: string,
  customerId: string,
  input: z.input<typeof addressFieldsSchema>,
) {
  const actor = await requirePermission("customers.manage");
  const data = addressFieldsSchema.parse(input);
  try {
    await updateCustomerAddress(addressId, addressPayload(data), actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function deleteCustomerAddressAction(addressId: string, customerId: string) {
  const actor = await requirePermission("customers.manage");
  try {
    await deleteCustomerAddress(addressId, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function setDefaultShippingAddressAction(addressId: string, customerId: string) {
  const actor = await requirePermission("customers.manage");
  try {
    await setDefaultShippingAddress(addressId, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function setDefaultBillingAddressAction(addressId: string, customerId: string) {
  const actor = await requirePermission("customers.manage");
  try {
    await setDefaultBillingAddress(addressId, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
}
