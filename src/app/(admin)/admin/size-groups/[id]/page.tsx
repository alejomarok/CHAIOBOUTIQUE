import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSizeGroupById } from "@/modules/attributes/service";
import { requirePermission } from "@/modules/auth";

import { CreateSizeOptionDialog } from "./create-size-option-dialog";
import { DeleteSizeGroupButton } from "./delete-size-group-button";
import { EditSizeOptionDialog } from "./edit-size-option-dialog";
import { SizeOptionActiveSwitch } from "./size-option-active-switch";

export const metadata = { title: "Detalle de grupo de talles" };

export default async function SizeGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("attributes.view");
  const canManage = user.permissions.has("attributes.manage");
  const { id } = await params;

  const sizeGroup = await getSizeGroupById(id);
  if (!sizeGroup) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{sizeGroup.name}</h1>
          <p className="text-muted-foreground text-sm">
            Código: <span className="font-mono">{sizeGroup.code}</span>
            {!sizeGroup.isActive && (
              <Badge variant="outline" className="ml-2">
                Inactivo
              </Badge>
            )}
          </p>
          <p className="text-muted-foreground text-sm">
            {sizeGroup._count.products === 0
              ? "Ningún producto usa este grupo todavía."
              : sizeGroup._count.products === 1
                ? "1 producto usa este grupo."
                : `${sizeGroup._count.products} productos usan este grupo.`}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-col items-end gap-2">
            <CreateSizeOptionDialog sizeGroupId={sizeGroup.id} />
            <DeleteSizeGroupButton
              sizeGroupId={sizeGroup.id}
              productCount={sizeGroup._count.products}
              optionCount={sizeGroup.options.length}
            />
          </div>
        )}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orden</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Nombre visible</TableHead>
              {canManage && <TableHead className="w-20">Activo</TableHead>}
              {canManage && <TableHead className="w-16" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sizeGroup.options.map((option) => (
              <TableRow key={option.id}>
                <TableCell className="text-muted-foreground text-xs">{option.sortOrder}</TableCell>
                <TableCell className="font-mono text-xs">{option.code}</TableCell>
                <TableCell className="font-medium">{option.label}</TableCell>
                {canManage && (
                  <TableCell>
                    <SizeOptionActiveSwitch
                      id={option.id}
                      sizeGroupId={sizeGroup.id}
                      isActive={option.isActive}
                    />
                  </TableCell>
                )}
                {canManage && (
                  <TableCell>
                    <EditSizeOptionDialog sizeGroupId={sizeGroup.id} option={option} />
                  </TableCell>
                )}
              </TableRow>
            ))}
            {sizeGroup.options.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 3} className="text-muted-foreground text-sm">
                  Este grupo todavía no tiene talles.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
