"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  addCustomerAddressAction,
  deleteCustomerAddressAction,
  setDefaultBillingAddressAction,
  setDefaultShippingAddressAction,
  updateCustomerAddressAction,
} from "../actions";

export interface CustomerAddressItem {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  floor: string | null;
  apartment: string | null;
  postalCode: string | null;
  city: string;
  province: string | null;
  country: string;
  notes: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

interface AddressFormState {
  label: string;
  street: string;
  number: string;
  floor: string;
  apartment: string;
  postalCode: string;
  city: string;
  province: string;
  notes: string;
}

const EMPTY_FORM: AddressFormState = {
  label: "",
  street: "",
  number: "",
  floor: "",
  apartment: "",
  postalCode: "",
  city: "",
  province: "",
  notes: "",
};

function toFormState(address: CustomerAddressItem): AddressFormState {
  return {
    label: address.label ?? "",
    street: address.street,
    number: address.number ?? "",
    floor: address.floor ?? "",
    apartment: address.apartment ?? "",
    postalCode: address.postalCode ?? "",
    city: address.city,
    province: address.province ?? "",
    notes: address.notes ?? "",
  };
}

function formatAddressLine(address: CustomerAddressItem): string {
  const parts = [
    address.street + (address.number ? ` ${address.number}` : ""),
    address.floor ? `piso ${address.floor}` : null,
    address.apartment ? `depto ${address.apartment}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

export function CustomerAddressManager({
  customerId,
  addresses,
}: {
  customerId: string;
  addresses: CustomerAddressItem[];
}) {
  const [dialogAddressId, setDialogAddressId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<AddressFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function openNewAddressDialog() {
    setForm(EMPTY_FORM);
    setDialogAddressId("new");
  }

  function openEditAddressDialog(address: CustomerAddressItem) {
    setForm(toFormState(address));
    setDialogAddressId(address.id);
  }

  async function handleSave() {
    if (!form.street.trim() || !form.city.trim()) {
      toast.error("La calle y la ciudad son obligatorias.");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        label: form.label,
        street: form.street,
        number: form.number,
        floor: form.floor,
        apartment: form.apartment,
        postalCode: form.postalCode,
        city: form.city,
        province: form.province,
        notes: form.notes,
      };
      if (dialogAddressId === "new") {
        await addCustomerAddressAction(customerId, payload);
        toast.success("Dirección agregada.");
      } else if (dialogAddressId) {
        await updateCustomerAddressAction(dialogAddressId, customerId, payload);
        toast.success("Dirección actualizada.");
      }
      setDialogAddressId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos guardar la dirección.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleDelete(addressId: string) {
    if (confirmingDeleteId !== addressId) {
      setConfirmingDeleteId(addressId);
      return;
    }
    setConfirmingDeleteId(null);
    setIsPending(true);
    deleteCustomerAddressAction(addressId, customerId)
      .then(() => toast.success("Dirección eliminada."))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "No pudimos eliminar la dirección."),
      )
      .finally(() => setIsPending(false));
  }

  function handleSetDefaultShipping(addressId: string) {
    setIsPending(true);
    setDefaultShippingAddressAction(addressId, customerId)
      .then(() => toast.success("Dirección de envío predeterminada actualizada."))
      .catch(() => toast.error("No pudimos actualizar la dirección predeterminada."))
      .finally(() => setIsPending(false));
  }

  function handleSetDefaultBilling(addressId: string) {
    setIsPending(true);
    setDefaultBillingAddressAction(addressId, customerId)
      .then(() => toast.success("Dirección de facturación predeterminada actualizada."))
      .catch(() => toast.error("No pudimos actualizar la dirección predeterminada."))
      .finally(() => setIsPending(false));
  }

  return (
    <div className="flex flex-col gap-4">
      {addresses.length === 0 ? (
        <p className="text-muted-foreground text-sm">Este cliente todavía no tiene direcciones cargadas.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {addresses.map((address) => (
            <div key={address.id} className="border-border rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{address.label || "Dirección"}</p>
                    {address.isDefaultShipping && <Badge variant="default">Envío predeterminado</Badge>}
                    {address.isDefaultBilling && <Badge variant="secondary">Facturación predeterminada</Badge>}
                  </div>
                  <p className="text-muted-foreground text-sm">{formatAddressLine(address)}</p>
                  <p className="text-muted-foreground text-sm">
                    {[address.postalCode, address.city, address.province].filter(Boolean).join(", ")}
                  </p>
                  {address.notes && (
                    <p className="text-muted-foreground text-xs">{address.notes}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => openEditAddressDialog(address)}>
                  Editar
                </Button>
                {!address.isDefaultShipping && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleSetDefaultShipping(address.id)}
                  >
                    Usar como envío predeterminado
                  </Button>
                )}
                {!address.isDefaultBilling && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleSetDefaultBilling(address.id)}
                  >
                    Usar como facturación predeterminada
                  </Button>
                )}
                {confirmingDeleteId === address.id ? (
                  <>
                    <Button size="sm" variant="destructive" disabled={isPending} onClick={() => handleDelete(address.id)}>
                      Confirmar
                    </Button>
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirmingDeleteId(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleDelete(address.id)}>
                    Eliminar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" className="self-start" onClick={openNewAddressDialog}>
        Agregar dirección
      </Button>

      <Dialog open={dialogAddressId !== null} onOpenChange={(open) => !open && setDialogAddressId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogAddressId === "new" ? "Agregar dirección" : "Editar dirección"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address-label">Etiqueta (opcional)</Label>
              <Input
                id="address-label"
                placeholder="Casa, Trabajo, Local"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="address-street">Calle</Label>
                <Input
                  id="address-street"
                  value={form.street}
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address-number">Número</Label>
                <Input
                  id="address-number"
                  value={form.number}
                  onChange={(e) => setForm({ ...form, number: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address-floor">Piso (opcional)</Label>
                <Input
                  id="address-floor"
                  value={form.floor}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address-apartment">Depto (opcional)</Label>
                <Input
                  id="address-apartment"
                  value={form.apartment}
                  onChange={(e) => setForm({ ...form, apartment: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address-postal">Código postal</Label>
                <Input
                  id="address-postal"
                  value={form.postalCode}
                  onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address-city">Ciudad</Label>
                <Input
                  id="address-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address-province">Provincia</Label>
                <Input
                  id="address-province"
                  value={form.province}
                  onChange={(e) => setForm({ ...form, province: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address-notes">Referencia (opcional)</Label>
              <Input
                id="address-notes"
                placeholder="Timbre 3B, entre calles..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <Button onClick={handleSave} disabled={isSaving} className="self-start">
              {isSaving ? "Guardando…" : "Guardar dirección"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
