import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listSizes } from "@/modules/attributes/service";
import { requirePermission } from "@/modules/auth";

import { CreateSizeDialog } from "./create-size-dialog";
import { SizeActiveSwitch } from "./size-active-switch";

export const metadata = { title: "Talles" };

export default async function SizesPage() {
  const user = await requirePermission("attributes.view");
  const canManage = user.permissions.has("attributes.manage");

  const sizes = await listSizes();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Talles</h1>
          <p className="text-muted-foreground text-sm">
            Vocabulario controlado — las variantes no usan texto libre.
          </p>
        </div>
        {canManage && <CreateSizeDialog />}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clave</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Grupo</TableHead>
              {canManage && <TableHead className="w-20">Activo</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sizes.map((size) => (
              <TableRow key={size.id}>
                <TableCell className="font-mono text-xs">{size.key}</TableCell>
                <TableCell className="font-medium">{size.displayName}</TableCell>
                <TableCell>{size.group ?? "—"}</TableCell>
                {canManage && (
                  <TableCell>
                    <SizeActiveSwitch id={size.id} isActive={size.isActive} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
