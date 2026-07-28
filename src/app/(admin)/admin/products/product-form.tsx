"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { createProductAction, updateProductAction } from "./actions";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  internalCode: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  defaultPriceAmount: z.string().optional(),
  compareAtPriceAmount: z.string().optional(),
  referenceCostAmount: z.string().optional(),
  minimumStockThreshold: z.string().optional(),
});
type FormInput = z.infer<typeof formSchema>;

export interface ProductFormProps {
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  canViewCost: boolean;
  productId?: string;
  defaultValues?: Partial<FormInput>;
}

export function ProductForm({
  categories,
  brands,
  canViewCost,
  productId,
  defaultValues,
}: ProductFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      internalCode: "",
      shortDescription: "",
      description: "",
      categoryId: "",
      brandId: "",
      seoTitle: "",
      seoDescription: "",
      defaultPriceAmount: "",
      compareAtPriceAmount: "",
      referenceCostAmount: "",
      minimumStockThreshold: "",
      ...defaultValues,
    },
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    const payload = {
      ...values,
      minimumStockThreshold: values.minimumStockThreshold
        ? Number(values.minimumStockThreshold)
        : undefined,
    };
    try {
      if (productId) {
        await updateProductAction(productId, payload);
        toast.success("Producto actualizado.");
        router.push(`/admin/products/${productId}`);
      } else {
        const result = await createProductAction(payload);
        toast.success("Producto creado. Ahora podés agregar variantes.");
        router.push(`/admin/products/${result.id}`);
      }
    } catch {
      toast.error("No pudimos guardar el producto. Revisá los datos.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="internalCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Código interno (opcional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Categoría</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sin categoría" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="brandId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Marca</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sin marca" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="shortDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción corta</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción completa</FormLabel>
              <FormControl>
                <Textarea rows={4} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="defaultPriceAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Precio</FormLabel>
                <FormControl>
                  <Input placeholder="15000,50" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="compareAtPriceAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Precio de comparación</FormLabel>
                <FormControl>
                  <Input placeholder="Opcional" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canViewCost && (
            <FormField
              control={form.control}
              name="referenceCostAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Costo de referencia</FormLabel>
                  <FormControl>
                    <Input placeholder="Opcional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="minimumStockThreshold"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Aviso de stock mínimo (opcional)</FormLabel>
              <FormControl>
                <Input type="number" min={0} step={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="seoTitle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Título SEO (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="seoDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descripción SEO (opcional)</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? "Guardando…" : productId ? "Guardar cambios" : "Crear producto"}
        </Button>
      </form>
    </Form>
  );
}
