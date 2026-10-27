import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { minorUnitsToDisplay } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import { listActiveBranches } from "@/modules/store-branches/branch";
import { getStoreConfiguration } from "@/modules/store-settings/service";

import { ArcaReadinessCard } from "./arca-readiness-card";
import { BranchesSettingsForm } from "./branches-settings-form";
import { ContactSettingsForm } from "./contact-settings-form";
import { DeliverySettingsForm } from "./delivery-settings-form";
import { FiscalSettingsForm } from "./fiscal-settings-form";
import { MercadoPagoReadinessCard } from "./mercado-pago-readiness-card";
import { ReservationSchedulerCard } from "./reservation-scheduler-card";
import { SocialSettingsForm } from "./social-settings-form";
import { StoreSettingsForm } from "./store-settings-form";

function toEditableAmount(amount: bigint): string {
  return minorUnitsToDisplay(amount).replace(/[^\d,.-]/g, "");
}

export const metadata = { title: "Configuración" };

export default async function StoreSettingsPage() {
  const user = await requirePermission("settings.view");
  const [storeConfiguration, branches] = await Promise.all([
    getStoreConfiguration(),
    listActiveBranches(),
  ]);
  const canManage = user.permissions.has("settings.manage");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Configuración de la tienda</h1>
        <p className="text-muted-foreground text-sm">Datos generales de la tienda.</p>
        <Link
          href="/admin/settings/production"
          className="mt-3 inline-flex min-h-11 items-center underline"
        >
          Ver preparación para publicar y estado de correos
        </Link>
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
            canManage={canManage}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Envío y retiro</CardTitle>
          <CardDescription>
            Costo de envío a domicilio e instrucciones de retiro para el checkout online.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeliverySettingsForm
            defaultValues={{
              homeDeliveryFlatFeeAmount:
                storeConfiguration.homeDeliveryFlatFeeAmount !== null
                  ? toEditableAmount(storeConfiguration.homeDeliveryFlatFeeAmount)
                  : "",
              pickupInstructions: storeConfiguration.pickupInstructions ?? "",
              homeDeliveryPostalCodes: storeConfiguration.homeDeliveryPostalCodes ?? "",
              homeDeliveryEstimate: storeConfiguration.homeDeliveryEstimate ?? "",
            }}
            canManage={canManage}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Información de contacto</CardTitle>
          <CardDescription>
            Se muestra en el pie de página de la tienda cuando está configurada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactSettingsForm
            defaultValues={{
              publicPhone: storeConfiguration.publicPhone ?? "",
              whatsappPhone: storeConfiguration.whatsappPhone ?? "",
              publicEmail: storeConfiguration.publicEmail ?? "",
            }}
            canManage={canManage}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sucursales</CardTitle>
          <CardDescription>Ubicaciones físicas mostradas en el pie de página.</CardDescription>
        </CardHeader>
        <CardContent>
          <BranchesSettingsForm
            branches={branches.map((branch) => ({
              id: branch.id,
              name: branch.name,
              address: branch.address,
              city: branch.city,
              province: branch.province ?? "",
            }))}
            canManage={canManage}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Redes sociales</CardTitle>
          <CardDescription>
            Se muestran como íconos en el pie de página — dejá una red vacía para ocultarla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SocialSettingsForm
            defaultValues={{
              instagramUrl: storeConfiguration.instagramUrl ?? "",
              facebookUrl: storeConfiguration.facebookUrl ?? "",
              tiktokUrl: storeConfiguration.tiktokUrl ?? "",
            }}
            canManage={canManage}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Datos fiscales</CardTitle>
          <CardDescription>
            Preparación para la facturación electrónica ARCA. Puede quedar en blanco por ahora — no
            afecta el checkout ni la tienda pública, y ARCA nunca se contacta desde acá.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FiscalSettingsForm
            defaultValues={{
              fiscalLegalName: storeConfiguration.fiscalLegalName ?? "",
              fiscalTaxId: storeConfiguration.fiscalTaxId ?? "",
              fiscalDefaultPointOfSale: storeConfiguration.fiscalDefaultPointOfSale ?? "",
              issuerVatCondition: storeConfiguration.issuerVatCondition ?? "",
              fiscalAddress: storeConfiguration.fiscalAddress ?? "",
              fiscalActivityStartDate: storeConfiguration.fiscalActivityStartDate
                ? storeConfiguration.fiscalActivityStartDate.toISOString().slice(0, 10)
                : "",
              fiscalGrossIncomeId: storeConfiguration.fiscalGrossIncomeId ?? "",
              arcaPointOfSale: storeConfiguration.arcaPointOfSale?.toString() ?? "",
              arcaEnvironment: storeConfiguration.arcaEnvironment ?? "",
              defaultTaxCategory: storeConfiguration.defaultTaxCategory ?? "",
            }}
            canManage={canManage}
          />
        </CardContent>
      </Card>
      <ArcaReadinessCard />

      <div>
        <h2 className="font-heading text-lg font-semibold">Integraciones</h2>
        <div className="mt-3 flex flex-col gap-6">
          <MercadoPagoReadinessCard />
          <ReservationSchedulerCard />
        </div>
      </div>
    </div>
  );
}
