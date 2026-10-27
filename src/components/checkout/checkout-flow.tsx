"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { submitCheckoutAction } from "@/app/(public)/checkout/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { minorUnitsToDisplay } from "@/lib/money";
// Type-only: the real module (@/modules/cart/service) is "server-only" and
// must never be pulled into a client bundle — same discipline as
// components/cart/cart-view.tsx.
import type { CartDTO } from "@/modules/cart/service";

type Step = "contact" | "delivery" | "summary";
const STEPS: { id: Step; label: string }[] = [
  { id: "contact", label: "Contacto" },
  { id: "delivery", label: "Entrega" },
  { id: "summary", label: "Resumen" },
];

interface ContactState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface SavedAddress {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  floor: string | null;
  apartment: string | null;
  postalCode: string | null;
  city: string;
  province: string | null;
  isDefaultShipping: boolean;
}

interface DeliveryMethodOptionDTO {
  deliveryEstimate?: string | null;
  postalCodes?: string | null;
  method: "PICKUP" | "HOME_DELIVERY";
  label: string;
  feeAmount: string;
  feeDisplay: string | null;
  pickupInstructions: string | null;
}

interface NewAddressState {
  street: string;
  number: string;
  floor: string;
  apartment: string;
  postalCode: string;
  city: string;
  province: string;
  notes: string;
}

const NEW_ADDRESS_OPTION = "new";

function addressSummary(address: SavedAddress): string {
  return [
    [address.street, address.number].filter(Boolean).join(" "),
    [address.floor, address.apartment].filter(Boolean).join(" "),
    address.city,
  ]
    .filter(Boolean)
    .join(", ");
}

export function CheckoutFlow({
  cart,
  isAuthenticated,
  contactPrefill,
  savedAddresses,
  deliveryMethods,
}: {
  cart: CartDTO;
  isAuthenticated: boolean;
  contactPrefill: ContactState | null;
  savedAddresses: SavedAddress[];
  deliveryMethods: DeliveryMethodOptionDTO[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("contact");
  const [contact, setContact] = useState<ContactState>(
    contactPrefill ?? { firstName: "", lastName: "", email: "", phone: "" },
  );
  const [deliveryMethod, setDeliveryMethod] = useState<"PICKUP" | "HOME_DELIVERY">(
    deliveryMethods[0]?.method ?? "PICKUP",
  );
  const defaultAddress = savedAddresses.find((a) => a.isDefaultShipping) ?? savedAddresses[0];
  const [selectedAddressId, setSelectedAddressId] = useState<string>(
    defaultAddress ? defaultAddress.id : NEW_ADDRESS_OPTION,
  );
  const [newAddress, setNewAddress] = useState<NewAddressState>({
    street: "",
    number: "",
    floor: "",
    apartment: "",
    postalCode: "",
    city: "",
    province: "",
    notes: "",
  });
  const [notes, setNotes] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Generated once per checkout session (not per submit) — a retry after a
  // network failure resubmits the SAME key, so the server recognizes and
  // safely no-ops instead of creating a second Order. See
  // modules/orders/order-core.ts's createOrderFromCart.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const homeDelivery = deliveryMethods.find((d) => d.method === "HOME_DELIVERY");
  const selectedDeliveryOption = deliveryMethods.find((d) => d.method === deliveryMethod);
  const shippingFeeAmount =
    deliveryMethod === "HOME_DELIVERY" ? BigInt(homeDelivery?.feeAmount ?? "0") : 0n;
  // Live preview only — never authoritative; the server recomputes and
  // validates the real total independently on submit (see
  // modules/orders/order-core.ts's createOrderFromCart). Mirrors
  // sale-form.tsx's own computePreviewTotal posture.
  const totalPreviewDisplay = minorUnitsToDisplay(BigInt(cart.subtotalAmount) + shippingFeeAmount, {
    currency: cart.currency,
  });

  function contactStepValid(): boolean {
    return (
      contact.firstName.trim().length > 0 &&
      contact.lastName.trim().length > 0 &&
      contact.email.trim().includes("@")
    );
  }

  function deliveryStepValid(): boolean {
    if (deliveryMethod === "PICKUP") return true;
    if (selectedAddressId !== NEW_ADDRESS_OPTION) return true;
    return newAddress.street.trim().length > 0 && newAddress.city.trim().length > 0;
  }

  function goNext() {
    if (step === "contact") {
      if (!contactStepValid()) {
        toast.error("Completá tu nombre, apellido y email.");
        return;
      }
      setStep("delivery");
      return;
    }
    if (step === "delivery") {
      if (!deliveryStepValid()) {
        toast.error("Ingresá una dirección de envío para continuar.");
        return;
      }
      setStep("summary");
    }
  }

  function goBack() {
    if (step === "delivery") setStep("contact");
    else if (step === "summary") setStep("delivery");
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    if (!termsAccepted) {
      toast.error("Aceptá los términos y la política de privacidad para continuar.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitCheckoutAction({
        termsAccepted: true,
        contact: {
          firstName: contact.firstName.trim(),
          lastName: contact.lastName.trim(),
          email: contact.email.trim(),
          phone: contact.phone.trim() || undefined,
        },
        deliveryMethod,
        existingAddressId:
          deliveryMethod === "HOME_DELIVERY" && selectedAddressId !== NEW_ADDRESS_OPTION
            ? selectedAddressId
            : undefined,
        newAddress:
          deliveryMethod === "HOME_DELIVERY" && selectedAddressId === NEW_ADDRESS_OPTION
            ? {
                street: newAddress.street.trim(),
                number: newAddress.number.trim() || undefined,
                floor: newAddress.floor.trim() || undefined,
                apartment: newAddress.apartment.trim() || undefined,
                postalCode: newAddress.postalCode.trim() || undefined,
                city: newAddress.city.trim(),
                province: newAddress.province.trim() || undefined,
                notes: newAddress.notes.trim() || undefined,
              }
            : undefined,
        notes: notes.trim() || undefined,
        idempotencyKey,
      });
      router.push(`/order/${result.accessToken}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos procesar tu pedido.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Progress indicator — always visible so the shopper knows where
          they are and what's left, per this phase's explicit UX
          requirement. */}
      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((s, index) => {
          const currentIndex = STEPS.findIndex((x) => x.id === step);
          const isCurrent = s.id === step;
          const isDone = index < currentIndex;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isDone
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {index + 1}
              </span>
              <span className={isCurrent ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
              {index < STEPS.length - 1 && <span className="bg-border ml-1 h-px flex-1" />}
            </li>
          );
        })}
      </ol>

      {step === "contact" && (
        <div className="flex flex-col gap-4">
          {isAuthenticated && (
            <p className="text-muted-foreground text-sm">
              Revisá tus datos de contacto para este pedido — podés editarlos sin que afecte tu
              perfil.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="checkout-first-name">Nombre</Label>
              <Input
                id="checkout-first-name"
                value={contact.firstName}
                onChange={(e) => setContact((prev) => ({ ...prev, firstName: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="checkout-last-name">Apellido</Label>
              <Input
                id="checkout-last-name"
                value={contact.lastName}
                onChange={(e) => setContact((prev) => ({ ...prev, lastName: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="checkout-email">Email</Label>
            <Input
              id="checkout-email"
              type="email"
              value={contact.email}
              onChange={(e) => setContact((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="checkout-phone">Teléfono (opcional)</Label>
            <Input
              id="checkout-phone"
              value={contact.phone}
              onChange={(e) => setContact((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </div>
          <Button type="button" className="mt-2 self-start" onClick={goNext}>
            Continuar
          </Button>
        </div>
      )}

      {step === "delivery" && (
        <div className="flex flex-col gap-5">
          <RadioGroup
            value={deliveryMethod}
            onValueChange={(value) => setDeliveryMethod(value as "PICKUP" | "HOME_DELIVERY")}
            className="gap-3"
          >
            {deliveryMethods.map((option) => (
              <label
                key={option.method}
                className="ring-border/60 has-data-checked:ring-primary flex cursor-pointer items-center justify-between gap-3 rounded-xl p-4 ring-1"
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem value={option.method} />
                  <span className="font-medium">{option.label}</span>
                </div>
                <span className="text-muted-foreground text-sm">
                  {option.feeDisplay ?? "Sin costo"}
                </span>
              </label>
            ))}
          </RadioGroup>

          {deliveryMethod === "PICKUP" && (
            <p className="bg-blush/50 rounded-xl p-4 text-sm">
              {deliveryMethods.find((d) => d.method === "PICKUP")?.pickupInstructions ||
                "Te contactaremos para coordinar el retiro."}
            </p>
          )}

          {deliveryMethod === "HOME_DELIVERY" && (
            <div className="flex flex-col gap-4">
              {savedAddresses.length > 0 && (
                <RadioGroup
                  value={selectedAddressId}
                  onValueChange={setSelectedAddressId}
                  className="gap-2"
                >
                  {savedAddresses.map((address) => (
                    <label
                      key={address.id}
                      className="ring-border/60 has-data-checked:ring-primary flex cursor-pointer items-start gap-3 rounded-xl p-3 text-sm ring-1"
                    >
                      <RadioGroupItem value={address.id} className="mt-0.5" />
                      <span>
                        {address.label && <span className="font-medium">{address.label} — </span>}
                        {addressSummary(address)}
                      </span>
                    </label>
                  ))}
                  <label className="ring-border/60 has-data-checked:ring-primary flex cursor-pointer items-center gap-3 rounded-xl p-3 text-sm ring-1">
                    <RadioGroupItem value={NEW_ADDRESS_OPTION} />
                    <span className="font-medium">Nueva dirección</span>
                  </label>
                </RadioGroup>
              )}

              {selectedAddressId === NEW_ADDRESS_OPTION && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor="addr-street">Calle</Label>
                    <Input
                      id="addr-street"
                      value={newAddress.street}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, street: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="addr-number">Número</Label>
                    <Input
                      id="addr-number"
                      value={newAddress.number}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, number: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="addr-floor">Piso / Departamento</Label>
                    <Input
                      id="addr-floor"
                      value={newAddress.floor}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, floor: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="addr-postal">Código postal</Label>
                    <Input
                      id="addr-postal"
                      value={newAddress.postalCode}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, postalCode: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="addr-city">Ciudad</Label>
                    <Input
                      id="addr-city"
                      value={newAddress.city}
                      onChange={(e) => setNewAddress((prev) => ({ ...prev, city: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="addr-province">Provincia</Label>
                    <Input
                      id="addr-province"
                      value={newAddress.province}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, province: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor="addr-notes">Referencias (opcional)</Label>
                    <Input
                      id="addr-notes"
                      placeholder="Timbre, entre calles, etc."
                      value={newAddress.notes}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, notes: e.target.value }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={goBack}>
              Atrás
            </Button>
            <Button type="button" onClick={goNext}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === "summary" && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-lg font-semibold">Tus productos</h2>
            <ul className="flex flex-col gap-2">
              {cart.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {item.quantity} × {item.productName}
                    {(item.sizeName || item.colorName) && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({[item.sizeName, item.colorName].filter(Boolean).join(" / ")})
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap">{item.lineTotalDisplay}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <h2 className="font-heading text-lg font-semibold">Contacto</h2>
            <p>
              {contact.firstName} {contact.lastName} — {contact.email}
              {contact.phone && ` — ${contact.phone}`}
            </p>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <h2 className="font-heading text-lg font-semibold">Entrega</h2>
            <p>{selectedDeliveryOption?.label}</p>
            {deliveryMethod === "HOME_DELIVERY" && selectedAddressId !== NEW_ADDRESS_OPTION && (
              <p className="text-muted-foreground">
                {addressSummary(savedAddresses.find((a) => a.id === selectedAddressId)!)}
              </p>
            )}
            {deliveryMethod === "HOME_DELIVERY" && selectedAddressId === NEW_ADDRESS_OPTION && (
              <p className="text-muted-foreground">
                {[newAddress.street, newAddress.number].filter(Boolean).join(" ")},{" "}
                {newAddress.city}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="checkout-notes">Notas para tu pedido (opcional)</Label>
            <Textarea
              id="checkout-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="bg-blush/50 flex flex-col gap-2 rounded-2xl p-5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{cart.subtotalDisplay}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Envío</span>
              <span>
                {shippingFeeAmount > 0n ? selectedDeliveryOption?.feeDisplay : "Sin costo"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-medium">Total</span>
              <span className="font-heading text-xl font-semibold">{totalPreviewDisplay}</span>
            </div>
          </div>

          {deliveryMethod === "HOME_DELIVERY" && (
            <p className="text-sm leading-6">
              Plazo estimado: {selectedDeliveryOption?.deliveryEstimate}. Cobertura: códigos
              postales {selectedDeliveryOption?.postalCodes}.
            </p>
          )}
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
            />
            <span>
              Acepto los{" "}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" className="underline">
                términos y condiciones
              </Link>{" "}
              y la{" "}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                política de privacidad
              </Link>
              .
            </span>
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={goBack}>
              Atrás
            </Button>
            <Button type="button" disabled={isSubmitting || !termsAccepted} onClick={handleSubmit}>
              {isSubmitting ? "Confirmando…" : "Confirmar pedido"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
