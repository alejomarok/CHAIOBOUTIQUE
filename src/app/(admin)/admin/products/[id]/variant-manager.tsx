"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  generateVariantMatrix,
  type VariantAxisCombination,
} from "@/modules/products/variant-matrix";

import { createVariantsAction, deactivateVariantAction } from "../actions";

interface ExistingVariant {
  id: string;
  sku: string;
  isActive: boolean;
  sizeName: string | null;
  colorName: string | null;
}

interface ProposedRow extends VariantAxisCombination {
  sku: string;
  priceAmount: string;
}

export function VariantManager({
  productId,
  sizes,
  colors,
  existingVariants,
  canManage,
}: {
  productId: string;
  sizes: { id: string; displayName: string }[];
  colors: { id: string; displayName: string }[];
  existingVariants: ExistingVariant[];
  canManage: boolean;
}) {
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [proposed, setProposed] = useState<ProposedRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleSize(id: string) {
    setSelectedSizes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }
  function toggleColor(id: string) {
    setSelectedColors((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function handleGenerate() {
    const combinations = generateVariantMatrix(selectedSizes, selectedColors);
    setProposed(
      combinations.map((combo) => ({
        ...combo,
        sku: "",
        priceAmount: "",
      })),
    );
  }

  function updateRow(index: number, patch: Partial<ProposedRow>) {
    setProposed((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit() {
    if (proposed.some((row) => !row.sku.trim())) {
      toast.error("Todas las variantes necesitan un SKU.");
      return;
    }
    setIsSubmitting(true);
    try {
      await createVariantsAction({
        productId,
        variants: proposed.map((row) => ({
          sizeId: row.sizeId,
          colorId: row.colorId,
          sku: row.sku,
          priceAmount: row.priceAmount || undefined,
        })),
      });
      toast.success("Variantes creadas.");
      setProposed([]);
      setSelectedSizes([]);
      setSelectedColors([]);
    } catch {
      toast.error("No pudimos crear las variantes. Verificá que no estén duplicadas.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDeactivate(variantId: string) {
    void (async () => {
      try {
        await deactivateVariantAction({ variantId, productId });
        toast.success("Variante desactivada.");
      } catch {
        toast.error("No pudimos desactivar la variante.");
      }
    })();
  }

  function sizeLabel(id: string | null) {
    return sizes.find((s) => s.id === id)?.displayName ?? "—";
  }
  function colorLabel(id: string | null) {
    return colors.find((c) => c.id === id)?.displayName ?? "—";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 font-medium">Variantes existentes</h3>
        {existingVariants.length === 0 ? (
          <p className="text-muted-foreground text-sm">Este producto todavía no tiene variantes.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Talle</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Estado</TableHead>
                {canManage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {existingVariants.map((variant) => (
                <TableRow key={variant.id}>
                  <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                  <TableCell>{variant.sizeName ?? "—"}</TableCell>
                  <TableCell>{variant.colorName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={variant.isActive ? "default" : "outline"}>
                      {variant.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {variant.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeactivate(variant.id)}
                        >
                          Desactivar
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {canManage && (
        <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
          <h3 className="font-medium">Generar variantes</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block">Talles</Label>
              <div className="flex flex-col gap-1.5">
                {sizes.map((size) => (
                  <label key={size.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedSizes.includes(size.id)}
                      onCheckedChange={() => toggleSize(size.id)}
                    />
                    {size.displayName}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Colores</Label>
              <div className="flex flex-col gap-1.5">
                {colors.map((color) => (
                  <label key={color.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedColors.includes(color.id)}
                      onCheckedChange={() => toggleColor(color.id)}
                    />
                    {color.displayName}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={handleGenerate}
            disabled={selectedSizes.length === 0 && selectedColors.length === 0}
          >
            Proponer variantes
          </Button>

          {proposed.length > 0 && (
            <div className="flex flex-col gap-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Talle</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Precio (opcional)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposed.map((row, index) => (
                    <TableRow key={`${row.sizeId}-${row.colorId}`}>
                      <TableCell>{sizeLabel(row.sizeId)}</TableCell>
                      <TableCell>{colorLabel(row.colorId)}</TableCell>
                      <TableCell>
                        <Input
                          value={row.sku}
                          onChange={(e) => updateRow(index, { sku: e.target.value })}
                          placeholder="SKU"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.priceAmount}
                          onChange={(e) => updateRow(index, { priceAmount: e.target.value })}
                          placeholder="Usa el precio del producto"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="self-start"
              >
                {isSubmitting ? "Creando…" : `Crear ${proposed.length} variante(s)`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
