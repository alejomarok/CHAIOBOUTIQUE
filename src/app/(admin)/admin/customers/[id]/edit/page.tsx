import { notFound } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { getCustomerById } from "@/modules/customers/customer";

import { CustomerForm } from "../../customer-form";

export const metadata = { title: "Editar cliente" };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("customers.manage");
  const { id } = await params;

  const customer = await getCustomerById(id);
  if (!customer) notFound();
  // "Consumidor Final" has no edit route reachable from the UI (the detail
  // page hides "Editar cliente" for it) — a direct URL visit renders the
  // same 404 as a nonexistent customer rather than a raw thrown-error
  // screen, consistent with "cannot be confused with a normal editable
  // person". The actual enforcement (never just UI hiding) is
  // updateCustomer's own SystemCustomerProtectedError check in
  // customer-core.ts, which every mutation path goes through regardless of
  // how it was reached.
  if (customer.isSystemDefault) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Editar cliente</h1>
      </div>
      <Card>
        <CardContent className="pt-6">
          <CustomerForm
            customerId={customer.id}
            defaultValues={{
              type: customer.type,
              firstName: customer.firstName ?? "",
              lastName: customer.lastName ?? "",
              businessName: customer.businessName ?? "",
              documentType: customer.documentType ?? "DNI",
              documentNumber: customer.documentNumber ?? "",
              taxId: customer.taxId ?? "",
              taxCondition: customer.taxCondition ?? "",
              email: customer.email ?? "",
              phone: customer.phone ?? "",
              notes: customer.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
