"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { updateCategoryAction } from "../actions";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  description: z.string().optional(),
  parentId: z.string().optional(),
  defaultSizeGroupId: z.string().optional(),
  showInStorefrontNav: z.boolean(),
});
type FormInput = z.infer<typeof formSchema>;

export function EditCategoryForm({
  category,
  parentOptions,
  sizeGroups,
  canManage,
}: {
  category: {
    id: string;
    name: string;
    description: string;
    parentId: string;
    defaultSizeGroupId: string;
    showInStorefrontNav: boolean;
  };
  parentOptions: { id: string; name: string }[];
  sizeGroups: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: category.name,
      description: category.description,
      parentId: category.parentId,
      defaultSizeGroupId: category.defaultSizeGroupId,
      showInStorefrontNav: category.showInStorefrontNav,
    },
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      // Every field is sent explicitly (never omitted/undefined) — this is
      // a full edit form representing the category's current complete
      // state, so an emptied picker means "clear this" (null), never
      // "leave whatever was there alone" (undefined) — see
      // updateCategoryAction's own null-clears/undefined-leaves-untouched
      // contract in app/(admin)/admin/categories/actions.ts.
      await updateCategoryAction({
        id: category.id,
        name: values.name,
        description: values.description || null,
        parentId: values.parentId || null,
        defaultSizeGroupId: values.defaultSizeGroupId || null,
        showInStorefrontNav: values.showInStorefrontNav,
      });
      toast.success("Categoría actualizada.");
    } catch {
      toast.error("No pudimos actualizar la categoría.");
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
                <Input {...field} disabled={!canManage} />
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
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Input {...field} disabled={!canManage} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="parentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Categoría padre (opcional)</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!canManage}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin categoría padre" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {parentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
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
          name="defaultSizeGroupId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Grupo de talles por defecto (opcional)</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!canManage}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin grupo por defecto" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {sizeGroups.map((sizeGroup) => (
                    <SelectItem key={sizeGroup.id} value={sizeGroup.id}>
                      {sizeGroup.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Se propone automáticamente al crear un producto en esta categoría.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="showInStorefrontNav"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={!canManage} />
              </FormControl>
              <div className="flex flex-col gap-1">
                <FormLabel className="font-normal">Mostrar en navegación pública</FormLabel>
                <p className="text-muted-foreground text-xs">
                  Aparece en el menú y en &quot;Explorá por categoría&quot; de la tienda.
                </p>
              </div>
            </FormItem>
          )}
        />
        {canManage ? (
          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? "Guardando…" : "Guardar cambios"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">No tenés permiso para modificar la categoría.</p>
        )}
      </form>
    </Form>
  );
}
