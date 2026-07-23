"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PERMISSIONS, PERMISSION_LABELS_ES, type Permission } from "@/modules/permissions/catalog";

import { updateRolePermissionsAction } from "./actions";

function groupByCategory(permissions: readonly Permission[]) {
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions) {
    const category = permission.split(".")[0];
    const list = groups.get(category) ?? [];
    list.push(permission);
    groups.set(category, list);
  }
  return groups;
}

const GROUPS = groupByCategory(PERMISSIONS);

export function RolePermissionsEditor({
  roleId,
  initialPermissions,
  readOnly,
}: {
  roleId: string;
  initialPermissions: Permission[];
  readOnly: boolean;
}) {
  const [selected, setSelected] = useState<Set<Permission>>(new Set(initialPermissions));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const groups = useMemo(() => [...GROUPS.entries()], []);

  function toggle(permission: Permission) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleSave() {
    setIsSubmitting(true);
    try {
      await updateRolePermissionsAction({ roleId, permissionKeys: [...selected] });
      toast.success("Permisos actualizados.");
    } catch {
      toast.error("No pudimos guardar los cambios.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map(([category, permissions]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase">{category}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {permissions.map((permission) => (
                <div key={permission} className="flex items-center gap-2">
                  <Checkbox
                    id={permission}
                    checked={selected.has(permission)}
                    disabled={readOnly}
                    onCheckedChange={() => toggle(permission)}
                  />
                  <Label htmlFor={permission} className="text-sm font-normal">
                    {PERMISSION_LABELS_ES[permission]}
                  </Label>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      {!readOnly && (
        <Button onClick={handleSave} disabled={isSubmitting} className="self-start">
          {isSubmitting ? "Guardando…" : "Guardar permisos"}
        </Button>
      )}
    </div>
  );
}
