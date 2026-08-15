import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";

import { CustomerForm } from "../customer-form";

export const metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  await requirePermission("customers.manage");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Nuevo cliente</h1>
        <p className="text-muted-foreground text-sm">
          Cargá una persona o una empresa. No hace falta crear una cuenta ni una contraseña — un
          cliente puede existir sin tener acceso online a la tienda.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <CustomerForm />
        </CardContent>
      </Card>
    </div>
  );
}
