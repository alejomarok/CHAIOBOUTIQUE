import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { getCustomerDisplayName } from "@/modules/customers/normalize";
import { listCustomers } from "@/modules/customers/customer";

import { CustomerFilters } from "./customer-filters";

export const metadata = { title: "Clientes" };

const PAGE_SIZE = 25;

interface CustomersPageProps {
  searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }>;
}

function isValidType(value: string | undefined): value is "PERSON" | "COMPANY" {
  return value === "PERSON" || value === "COMPANY";
}
function isValidStatus(value: string | undefined): value is "active" | "inactive" {
  return value === "active" || value === "inactive";
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const user = await requirePermission("customers.view");
  const canManage = user.permissions.has("customers.manage");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const type = isValidType(params.type) ? params.type : undefined;
  const status = isValidStatus(params.status) ? params.status : undefined;

  const { customers, total } = await listCustomers({
    search: params.q || undefined,
    type,
    status,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Clientes</h1>
          <p className="text-muted-foreground text-sm">
            Personas y empresas que compran en la tienda, tengan o no una cuenta online.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/admin/customers/new">Nuevo cliente</Link>
          </Button>
        )}
      </div>

      <CustomerFilters defaultValues={{ q: params.q, type: params.type, status: params.status }} />

      {customers.length === 0 ? (
        <div className="border-border rounded-xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            {params.q || type || status
              ? "No encontramos clientes con esos filtros."
              : "Todavía no hay clientes cargados."}
          </p>
          {canManage && !params.q && !type && !status && (
            <Button asChild className="mt-4">
              <Link href="/admin/customers/new">Crear el primer cliente</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre / Razón social</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Cuenta online</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/customers/${customer.id}`} className="hover:underline">
                      {getCustomerDisplayName(customer)}
                    </Link>
                    {customer.isSystemDefault && (
                      <Badge variant="secondary" className="ml-2">
                        Sistema
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {customer.documentNumber
                      ? `${customer.documentType ?? ""} ${customer.documentNumber}`.trim()
                      : (customer.taxId ?? "—")}
                  </TableCell>
                  <TableCell>{customer.email ?? "—"}</TableCell>
                  <TableCell>{customer.phone ?? "—"}</TableCell>
                  <TableCell>{customer.type === "PERSON" ? "Persona" : "Empresa"}</TableCell>
                  <TableCell>
                    <Badge variant={customer.isActive ? "default" : "outline"}>
                      {customer.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={customer.linkedUserId ? "default" : "outline"}>
                      {customer.linkedUserId ? "Sí" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/customers/${customer.id}`}>Ver</Link>
                      </Button>
                      {canManage && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/customers/${customer.id}/edit`}>Editar</Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Página {page} de {totalPages} ({total} clientes)
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={{
                    pathname: "/admin/customers",
                    query: { ...params, page: page - 1 },
                  }}
                >
                  Anterior
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={{
                    pathname: "/admin/customers",
                    query: { ...params, page: page + 1 },
                  }}
                >
                  Siguiente
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
