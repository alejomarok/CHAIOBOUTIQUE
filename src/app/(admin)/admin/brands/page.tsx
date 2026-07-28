import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listBrands } from "@/modules/brands/service";
import { requirePermission } from "@/modules/auth";

import { BrandActiveSwitch } from "./brand-active-switch";
import { CreateBrandDialog } from "./create-brand-dialog";

export const metadata = { title: "Marcas" };

export default async function BrandsPage() {
  const user = await requirePermission("brands.view");
  const canManage = user.permissions.has("brands.manage");

  const brands = await listBrands();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Marcas</h1>
          <p className="text-muted-foreground text-sm">Un producto puede no tener marca.</p>
        </div>
        {canManage && <CreateBrandDialog />}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Productos</TableHead>
              {canManage && <TableHead className="w-20">Activa</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">{brand.name}</TableCell>
                <TableCell>{brand._count.products}</TableCell>
                {canManage && (
                  <TableCell>
                    <BrandActiveSwitch id={brand.id} isActive={brand.isActive} />
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
