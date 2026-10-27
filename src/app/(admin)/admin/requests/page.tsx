import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/modules/auth";
import { RequestManagementForm } from "@/components/orders/request-management-form";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const metadata = { title: "Solicitudes de clientes" };
const kinds: Record<string, string> = {
  WITHDRAWAL: "Arrepentimiento",
  EXCHANGE: "Cambio o devolución",
  PRIVACY: "Datos personales",
};
const states: Record<string, string> = {
  PENDING: "Pendiente",
  PROCESSING: "En gestión",
  RESOLVED: "Resuelta",
  REJECTED: "Respondida: no corresponde",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ history?: string }>;
}) {
  await requirePermission("orders.manage");
  const history = (await searchParams).history === "1";
  const requests = await prisma.consumerRequest.findMany({
    where: history ? {} : { status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-3xl">Solicitudes de clientes</h1>
        <p className="text-muted-foreground mt-2">
          Gestioná arrepentimientos, cambios y derechos sobre datos personales.
        </p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={history ? "/admin/requests" : "/admin/requests?history=1"}
        >
          {history ? "Ver pendientes" : "Ver últimas 50 solicitudes"}
        </Link>
      </div>
      {!requests.length && (
        <Card>
          <CardContent className="py-8">No hay solicitudes para mostrar.</CardContent>
        </Card>
      )}
      {requests.map((request) => (
        <Card key={request.id}>
          <CardHeader>
            <CardTitle>
              {request.code} · {kinds[request.kind]}
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {states[request.status]} ·{" "}
              {request.createdAt.toLocaleString("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires",
              })}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Persona</dt>
                <dd>{request.fullName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contacto</dt>
                <dd className="break-all">
                  {request.email} {request.phone}
                </dd>
              </div>
              {request.orderCode && (
                <div>
                  <dt className="text-muted-foreground">Pedido informado</dt>
                  <dd>{request.orderCode}</dd>
                </div>
              )}
              {request.message && (
                <div>
                  <dt className="text-muted-foreground">Mensaje</dt>
                  <dd className="break-words whitespace-pre-wrap">{request.message}</dd>
                </div>
              )}
            </dl>
            {request.resolution && (
              <p className="text-sm whitespace-pre-wrap">Última respuesta: {request.resolution}</p>
            )}
            {["PENDING", "PROCESSING"].includes(request.status) && (
              <RequestManagementForm id={request.id} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
