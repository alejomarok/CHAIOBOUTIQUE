"use client";

import { MoreHorizontal } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  assignRoleAction,
  disableUserAction,
  enableUserAction,
  revokeRoleAction,
  revokeSessionsAction,
} from "./actions";

export function UserRowActions({
  userId,
  isActive,
  assignedRoleIds,
  roles,
}: {
  userId: string;
  isActive: boolean;
  assignedRoleIds: string[];
  roles: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();

  function handle(action: () => Promise<void>, successMessage: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(successMessage);
      } catch {
        toast.error("No pudimos completar la acción.");
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={isPending}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isActive ? (
          <DropdownMenuItem
            onSelect={() => handle(() => disableUserAction({ userId }), "Usuaria deshabilitada.")}
          >
            Deshabilitar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() => handle(() => enableUserAction({ userId }), "Usuaria habilitada.")}
          >
            Habilitar
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => handle(() => revokeSessionsAction({ userId }), "Sesiones revocadas.")}
        >
          Revocar sesiones
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {roles.map((role) => {
          const isAssigned = assignedRoleIds.includes(role.id);
          return (
            <DropdownMenuItem
              key={role.id}
              onSelect={() =>
                handle(
                  () =>
                    isAssigned
                      ? revokeRoleAction({ userId, roleId: role.id })
                      : assignRoleAction({ userId, roleId: role.id }),
                  isAssigned ? `Rol ${role.name} quitado.` : `Rol ${role.name} asignado.`,
                )
              }
            >
              {isAssigned ? "Quitar" : "Asignar"} {role.name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
