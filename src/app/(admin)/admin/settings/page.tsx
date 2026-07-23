import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { getStoreConfiguration } from "@/modules/store-settings/service";

import { StoreSettingsForm } from "./store-settings-form";

export const metadata = { title: "Configuración" };

export default async function StoreSettingsPage() {
  const user = await requirePermission("settings.view");
  const storeConfiguration = await getStoreConfiguration();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Configuración de la tienda</h1>
        <p className="text-muted-foreground text-sm">
          Datos generales. La configuración fiscal se agrega en una etapa posterior.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Nombre, moneda, idioma y zona horaria de la tienda.</CardDescription>
        </CardHeader>
        <CardContent>
          <StoreSettingsForm
            defaultValues={{
              name: storeConfiguration.name,
              currency: storeConfiguration.currency,
              locale: storeConfiguration.locale,
              timezone: storeConfiguration.timezone,
            }}
            canManage={user.permissions.has("settings.manage")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
