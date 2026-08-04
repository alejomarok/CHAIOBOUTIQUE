import { ChevronRight } from "lucide-react";
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
import { listSizeGroups } from "@/modules/attributes/service";
import { requirePermission } from "@/modules/auth";

import { CreateSizeGroupDialog } from "./create-size-group-dialog";
import { SizeGroupActiveSwitch } from "./size-group-active-switch";

export const metadata = { title: "Grupos de talles" };

export default async function SizeGroupsPage() {
  const user = await requirePermission("attributes.view");
  const canManage = user.permissions.has("attributes.manage");

  const sizeGroups = await listSizeGroups();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Grupos de talles</h1>
          <p className="text-muted-foreground text-sm">
            Cada grupo define su propio conjunto de talles — &ldquo;40&rdquo; en Pantalones y
            &ldquo;40&rdquo; en Calzado son talles distintos.
          </p>
        </div>
        {canManage && (
          <CreateSizeGroupDialog
            existingGroups={sizeGroups.map((g) => ({ code: g.code, name: g.name }))}
          />
        )}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Talles</TableHead>
              <TableHead>Productos</TableHead>
              {canManage && <TableHead className="w-20">Activo</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sizeGroups.map((sizeGroup) => (
              <TableRow key={sizeGroup.id}>
                <TableCell className="font-mono text-xs">{sizeGroup.code}</TableCell>
                <TableCell className="font-medium">
                  <Link href={`/admin/size-groups/${sizeGroup.id}`} className="hover:underline">
                    {sizeGroup.name}
                  </Link>
                  {!sizeGroup.isActive && (
                    <Badge variant="outline" className="ml-2">
                      Inactivo
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{sizeGroup._count.options}</TableCell>
                <TableCell>{sizeGroup._count.products}</TableCell>
                {canManage && (
                  <TableCell>
                    <SizeGroupActiveSwitch id={sizeGroup.id} isActive={sizeGroup.isActive} />
                  </TableCell>
                )}
                <TableCell>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/size-groups/${sizeGroup.id}`}>
                      Gestionar talles
                      <ChevronRight className="size-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sizeGroups.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 6 : 5} className="text-muted-foreground text-sm">
                  Todavía no hay grupos de talles.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
