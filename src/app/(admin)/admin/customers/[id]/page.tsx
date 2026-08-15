import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { getCustomerById } from "@/modules/customers/customer";
import { getCustomerDisplayName } from "@/modules/customers/normalize";

import { CustomerAddressManager } from "./customer-address-manager";
import { CustomerOnlineAccount } from "./customer-online-account";
import { CustomerStatusActions } from "./customer-status-actions";

export const metadata = { title: "Detalle de cliente" };

const TAX_CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTO: "Monotributo",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  NO_RESPONSABLE: "No Responsable",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("customers.view");
  const canManage = user.permissions.has("customers.manage");
  const { id } = await params;

  const customer = await getCustomerById(id);
  if (!customer) notFound();

  const displayName = getCustomerDisplayName(customer);
  const documentLabel = customer.documentNumber
    ? `${customer.documentType ?? "Documento"}: ${customer.documentNumber}`
    : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{displayName}</h1>
            <Badge variant="outline">{customer.type === "PERSON" ? "Persona" : "Empresa"}</Badge>
            <Badge variant={customer.isActive ? "default" : "outline"}>
              {customer.isActive ? "Activo" : "Inactivo"}
            </Badge>
            {customer.isSystemDefault && <Badge variant="secondary">Cliente del sistema</Badge>}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {documentLabel && <span>{documentLabel}</span>}
            {customer.phone && <span>{customer.phone}</span>}
            {customer.email && <span>{customer.email}</span>}
            <span>Cuenta online: {customer.linkedUserId ? "Sí" : "No"}</span>
          </div>
        </div>
        {canManage && !customer.isSystemDefault && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/admin/customers/${customer.id}/edit`}>Editar cliente</Link>
            </Button>
            <CustomerStatusActions customerId={customer.id} isActive={customer.isActive} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos generales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">Código</p>
            <p className="font-mono text-sm">{customer.code}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Tipo</p>
            <p>{customer.type === "PERSON" ? "Persona" : "Empresa"}</p>
          </div>
          {customer.type === "PERSON" ? (
            <>
              <div>
                <p className="text-muted-foreground text-xs">Nombre</p>
                <p>{customer.firstName ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Apellido</p>
                <p>{customer.lastName ?? "—"}</p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-muted-foreground text-xs">Razón social</p>
              <p>{customer.businessName ?? "—"}</p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground text-xs">Email</p>
            <p>{customer.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Teléfono</p>
            <p>{customer.phone ?? "—"}</p>
          </div>
          {customer.notes && (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground text-xs">Notas internas</p>
              <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos fiscales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {customer.type === "PERSON" && (
            <>
              <div>
                <p className="text-muted-foreground text-xs">Tipo de documento</p>
                <p>{customer.documentType ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Número de documento</p>
                <p>{customer.documentNumber ?? "—"}</p>
              </div>
            </>
          )}
          <div>
            <p className="text-muted-foreground text-xs">CUIT</p>
            <p>{customer.taxId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Condición fiscal</p>
            <p>
              {customer.taxCondition
                ? (TAX_CONDITION_LABELS[customer.taxCondition] ?? customer.taxCondition)
                : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card id="direcciones">
        <CardHeader>
          <CardTitle>Direcciones</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <CustomerAddressManager customerId={customer.id} addresses={customer.addresses} />
          ) : customer.addresses.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Este cliente todavía no tiene direcciones cargadas.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {customer.addresses.map((address) => (
                <li key={address.id}>
                  {address.street} {address.number}, {address.city}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="cuenta-online">
        <CardHeader>
          <CardTitle>Cuenta online</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <CustomerOnlineAccount customerId={customer.id} linkedUser={customer.linkedUser} />
          ) : (
            <p className="text-sm">
              {customer.linkedUser ? `Vinculada a ${customer.linkedUser.email}.` : "Sin cuenta vinculada."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card id="historial">
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Ventas/pedidos/facturas/devoluciones no existen todavía — ver
              Fase de Sales. Esta sección queda lista para mostrarlos sin
              rediseñar la página cuando ese módulo exista. */}
          <p className="text-muted-foreground text-sm">
            Este cliente todavía no tiene compras registradas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
