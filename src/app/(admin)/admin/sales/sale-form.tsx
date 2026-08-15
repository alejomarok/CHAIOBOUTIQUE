"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deserializeMoney, displayToMinorUnits, minorUnitsToDisplay } from "@/lib/money";

import {
  createSaleAction,
  getAvailableStockForVariantsAction,
  searchSellableVariantsAction,
  updateSaleAction,
  type SellableVariantDTO,
} from "./actions";

// Same "$ 1.500,50" -> "1.500,50" strip used by admin/products/[id]/edit/
// page.tsx to turn a formatted display amount back into an editable bare
// string — no separate "minor units to bare editable string" export exists
// in lib/money.ts, so this mirrors that exact established approach rather
// than inventing a new one.
function toEditableAmount(serializedMinorUnits: string): string {
  return minorUnitsToDisplay(deserializeMoney(serializedMinorUnits)).replace(/[^\d,.-]/g, "");
}

interface LineItem {
  productVariantId: string;
  displayName: string;
  sku: string;
  quantity: string;
  unitPriceAmount: string;
  discountAmount: string;
}

export interface SaleFormDefaultValues {
  customerId: string;
  warehouseId: string;
  notes: string;
  items: LineItem[];
}

export interface SaleFormWarehouseOption {
  id: string;
  code: string;
  name: string;
}

export interface SaleFormProps {
  saleId?: string;
  customers: { id: string; displayName: string; isSystemDefault: boolean }[];
  defaultCustomerId: string;
  canApplyDiscount: boolean;
  // Every active warehouse the actor is allowed to see — only meaningful
  // when canSelectWarehouse is true; otherwise the form pins to
  // defaultWarehouseId and shows it read-only (see requirement 2: "admin
  // can select another active warehouse when permitted").
  warehouses: SaleFormWarehouseOption[];
  defaultWarehouseId: string;
  canSelectWarehouse: boolean;
  defaultValues?: SaleFormDefaultValues;
}

// Live preview total only — BigInt-exact (reuses the same money utilities
// the server uses), but never authoritative; the server recomputes and
// validates everything independently on submit (see modules/sales/
// totals.ts). A line with input that doesn't parse yet (mid-typing) is
// simply skipped from the running preview rather than erroring.
function computePreviewTotal(items: LineItem[]): bigint {
  let total = 0n;
  for (const item of items) {
    try {
      const quantity = BigInt(Math.max(0, Math.floor(Number(item.quantity) || 0)));
      const unitPrice = item.unitPriceAmount ? displayToMinorUnits(item.unitPriceAmount) : 0n;
      const discount = item.discountAmount ? displayToMinorUnits(item.discountAmount) : 0n;
      total += unitPrice * quantity - discount;
    } catch {
      // Invalid/incomplete input — excluded from the live preview; the
      // server rejects it for real on submit.
    }
  }
  return total;
}

export function SaleForm({
  saleId,
  customers,
  defaultCustomerId,
  canApplyDiscount,
  warehouses,
  defaultWarehouseId,
  canSelectWarehouse,
  defaultValues,
}: SaleFormProps) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(defaultValues?.customerId ?? defaultCustomerId);
  const [warehouseId, setWarehouseId] = useState(
    defaultValues?.warehouseId ?? defaultWarehouseId,
  );
  const [notes, setNotes] = useState(defaultValues?.notes ?? "");
  const [items, setItems] = useState<LineItem[]>(defaultValues?.items ?? []);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SellableVariantDTO[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableStock, setAvailableStock] = useState<Record<string, number>>({});

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);

  // Re-checks available stock for every line already on the sale whenever
  // the selected warehouse or the set of lines changes — display-only
  // ("Disponible: N" per requirement 7); the server re-reads authoritative
  // stock again at confirmation time regardless (see actions.ts).
  useEffect(() => {
    const variantIds = [...new Set(items.map((item) => item.productVariantId))];
    // No lines (or no warehouse yet) — nothing to look up. Stale entries
    // left in availableStock are harmless: nothing reads them while the
    // items table is empty, and adding a line resets its own entry anyway
    // (see addItem).
    if (variantIds.length === 0 || !warehouseId) return;
    let cancelled = false;
    getAvailableStockForVariantsAction({ variantIds, warehouseId })
      .then((stock) => {
        if (!cancelled) setAvailableStock(stock);
      })
      .catch(() => {
        // Display-only lookup — a failure here just leaves stale/blank
        // numbers shown; it never blocks editing or submitting the sale.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, items.map((item) => item.productVariantId).join(",")]);

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (!warehouseId) {
      toast.error("Seleccioná un depósito antes de buscar productos.");
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchSellableVariantsAction({ query: searchQuery, warehouseId });
      setSearchResults(results);
    } catch {
      toast.error("No pudimos buscar productos. Intentá de nuevo.");
    } finally {
      setIsSearching(false);
    }
  }

  function addItem(variant: SellableVariantDTO) {
    setItems((prev) => [
      ...prev,
      {
        productVariantId: variant.id,
        displayName: variant.displayName,
        sku: variant.sku,
        quantity: "1",
        unitPriceAmount: variant.effectivePriceAmount ? toEditableAmount(variant.effectivePriceAmount) : "",
        discountAmount: "",
      },
    ]);
    setAvailableStock((prev) => ({ ...prev, [variant.id]: variant.availableStock }));
    setSearchQuery("");
    setSearchResults([]);
  }

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(confirm: boolean) {
    if (items.length === 0) {
      toast.error("Agregá al menos un producto.");
      return;
    }
    if (!customerId) {
      toast.error("Seleccioná un cliente.");
      return;
    }
    if (!warehouseId) {
      toast.error("Seleccioná un depósito.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        customerId,
        warehouseId,
        items: items.map((item) => ({
          productVariantId: item.productVariantId,
          quantity: Math.floor(Number(item.quantity)) || 0,
          unitPriceAmount: item.unitPriceAmount || undefined,
          discountAmount: item.discountAmount || undefined,
        })),
        notes,
        confirm,
      };

      let targetId = saleId;
      if (targetId) {
        await updateSaleAction(targetId, payload);
      } else {
        const result = await createSaleAction(payload);
        targetId = result.id;
      }

      toast.success(
        confirm ? "Venta confirmada correctamente.\nEl stock fue actualizado." : "Borrador guardado.",
      );
      router.push(`/admin/sales/${targetId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos guardar la venta.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const consumidorFinal = customers.find((c) => c.isSystemDefault);
  const previewTotal = computePreviewTotal(items);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sale-customer">Cliente</Label>
        <div className="flex flex-wrap gap-2">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger id="sale-customer" className="w-full max-w-sm">
              <SelectValue placeholder="Seleccioná un cliente" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.displayName}
                  {customer.isSystemDefault ? " (sin identificar)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {consumidorFinal && customerId !== consumidorFinal.id && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCustomerId(consumidorFinal.id)}
            >
              Usar Consumidor Final
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sale-warehouse">Depósito</Label>
        {canSelectWarehouse ? (
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger id="sale-warehouse" className="w-full max-w-sm">
              <SelectValue placeholder="Seleccioná un depósito" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm font-medium">
            Depósito: {selectedWarehouse?.name ?? "Depósito principal"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Label>Agregar producto</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Buscar por nombre, SKU o código de barras"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSearch();
              }
            }}
            className="max-w-sm"
          />
          <Button type="button" variant="outline" onClick={handleSearch} disabled={isSearching}>
            {isSearching ? "Buscando…" : "Buscar"}
          </Button>
        </div>
        {searchResults.length > 0 && (
          <div className="border-border flex flex-col gap-1 rounded-lg border p-2">
            {searchResults.map((variant) => (
              <div
                key={variant.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md p-1.5 text-sm hover:bg-muted"
              >
                <div>
                  <span className="font-medium">{variant.displayName}</span>{" "}
                  <span className="text-muted-foreground font-mono text-xs">{variant.sku}</span>
                  {variant.effectivePriceAmount && (
                    <span className="text-muted-foreground ml-2">
                      {minorUnitsToDisplay(deserializeMoney(variant.effectivePriceAmount))}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-2">
                    Disponible: {variant.availableStock}
                  </span>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => addItem(variant)}>
                  Agregar
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Todavía no agregaste productos a esta venta.
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="w-24">Cantidad</TableHead>
                <TableHead className="w-28">Disponible</TableHead>
                <TableHead className="w-32">Precio unitario</TableHead>
                {canApplyDiscount && <TableHead className="w-32">Descuento</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const requested = Math.floor(Number(item.quantity)) || 0;
                const available = availableStock[item.productVariantId];
                const insufficient = available !== undefined && requested > available;
                return (
                  <TableRow key={`${item.productVariantId}-${index}`}>
                    <TableCell>
                      <p className="font-medium">{item.displayName}</p>
                      <p className="text-muted-foreground font-mono text-xs">{item.sku}</p>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(index, { quantity: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <span className={insufficient ? "text-destructive font-medium" : "text-muted-foreground"}>
                        {available ?? "…"}
                      </span>
                      {insufficient && (
                        <p className="text-destructive text-xs">Stock insuficiente</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.unitPriceAmount}
                        onChange={(e) => updateItem(index, { unitPriceAmount: e.target.value })}
                        placeholder="0,00"
                      />
                    </TableCell>
                    {canApplyDiscount && (
                      <TableCell>
                        <Input
                          value={item.discountAmount}
                          onChange={(e) => updateItem(index, { discountAmount: e.target.value })}
                          placeholder="0,00"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(index)}>
                        ×
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sale-notes">Notas (opcional)</Label>
        <Textarea
          id="sale-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="border-border flex items-center justify-between rounded-lg border p-4">
        <span className="font-medium">Total</span>
        <span className="font-heading text-xl font-semibold">
          {minorUnitsToDisplay(previewTotal)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => handleSubmit(false)}
        >
          {isSubmitting ? "Guardando…" : "Guardar borrador"}
        </Button>
        <Button type="button" disabled={isSubmitting} onClick={() => handleSubmit(true)}>
          {isSubmitting ? "Guardando…" : "Confirmar venta"}
        </Button>
      </div>
    </div>
  );
}
