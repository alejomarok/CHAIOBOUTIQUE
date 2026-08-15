"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { linkCustomerToUserAction, unlinkCustomerFromUserAction } from "../actions";

interface LinkedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export function CustomerOnlineAccount({
  customerId,
  linkedUser,
}: {
  customerId: string;
  linkedUser: LinkedUser | null;
}) {
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  function handleLink() {
    if (!email.trim()) {
      toast.error("Ingresá el email de la cuenta a vincular.");
      return;
    }
    setIsPending(true);
    linkCustomerToUserAction({ customerId, email: email.trim() })
      .then(() => {
        toast.success("Cuenta vinculada.");
        setEmail("");
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "No pudimos vincular la cuenta."))
      .finally(() => setIsPending(false));
  }

  function handleUnlink() {
    if (!confirmingUnlink) {
      setConfirmingUnlink(true);
      return;
    }
    setConfirmingUnlink(false);
    setIsPending(true);
    unlinkCustomerFromUserAction(customerId)
      .then(() => toast.success("Cuenta desvinculada."))
      .catch(() => toast.error("No pudimos desvincular la cuenta."))
      .finally(() => setIsPending(false));
  }

  if (linkedUser) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Cuenta vinculada</Badge>
          {!linkedUser.emailVerified && <Badge variant="outline">Email sin verificar</Badge>}
        </div>
        <p className="text-sm">{linkedUser.name}</p>
        <p className="text-muted-foreground text-sm">{linkedUser.email}</p>
        {confirmingUnlink ? (
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={isPending} onClick={handleUnlink}>
              Confirmar desvinculación
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirmingUnlink(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="self-start" disabled={isPending} onClick={handleUnlink}>
            Desvincular cuenta
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Badge variant="outline" className="w-fit">
        Sin cuenta online
      </Badge>
      <p className="text-muted-foreground text-sm">
        Este cliente todavía no tiene acceso a la tienda online. Si ya tiene una cuenta creada,
        vinculala por email.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          type="email"
          placeholder="email@cliente.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="max-w-64"
        />
        <Button size="sm" variant="outline" disabled={isPending} onClick={handleLink}>
          Vincular cuenta
        </Button>
      </div>
    </div>
  );
}
