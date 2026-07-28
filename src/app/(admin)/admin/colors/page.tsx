import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listColors } from "@/modules/attributes/service";
import { requirePermission } from "@/modules/auth";

import { ColorActiveSwitch } from "./color-active-switch";
import { CreateColorDialog } from "./create-color-dialog";

export const metadata = { title: "Colores" };

export default async function ColorsPage() {
  const user = await requirePermission("attributes.view");
  const canManage = user.permissions.has("attributes.manage");

  const colors = await listColors();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Colores</h1>
          <p className="text-muted-foreground text-sm">
            El nombre es el valor de negocio — el color hexadecimal es solo una ayuda visual.
          </p>
        </div>
        {canManage && <CreateColorDialog />}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>Clave</TableHead>
              <TableHead>Nombre</TableHead>
              {canManage && <TableHead className="w-20">Activo</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {colors.map((color) => (
              <TableRow key={color.id}>
                <TableCell>
                  <span
                    className="border-border inline-block size-4 rounded-full border"
                    style={{ backgroundColor: color.hexPrimary ?? "transparent" }}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{color.key}</TableCell>
                <TableCell className="font-medium">{color.displayName}</TableCell>
                {canManage && (
                  <TableCell>
                    <ColorActiveSwitch id={color.id} isActive={color.isActive} />
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
