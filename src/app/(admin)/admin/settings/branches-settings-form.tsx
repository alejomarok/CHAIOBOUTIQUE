"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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

import { updateBranchAction } from "./actions";

const formSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "El nombre es obligatorio"),
  address: z.string().min(1, "La dirección es obligatoria"),
  city: z.string().min(1, "La ciudad es obligatoria"),
  province: z.string(),
});
type FormInput = z.infer<typeof formSchema>;

// One editable branch — see app/(admin)/admin/settings/page.tsx, which
// renders one of these per StoreBranch row. Kept a small, reusable
// sub-component rather than a single giant form, since each branch saves
// independently.
function BranchForm({ defaultValues, canManage }: { defaultValues: FormInput; canManage: boolean }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      await updateBranchAction(values);
      toast.success("Sucursal actualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos guardar los cambios.");
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
                <Input disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dirección</FormLabel>
              <FormControl>
                <Input disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ciudad</FormLabel>
                <FormControl>
                  <Input disabled={!canManage} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="province"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Provincia</FormLabel>
                <FormControl>
                  <Input disabled={!canManage} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {canManage && (
          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? "Guardando…" : "Guardar sucursal"}
          </Button>
        )}
      </form>
    </Form>
  );
}

export function BranchesSettingsForm({
  branches,
  canManage,
}: {
  branches: FormInput[];
  canManage: boolean;
}) {
  if (branches.length === 0) {
    return <p className="text-muted-foreground text-sm">Todavía no hay sucursales configuradas.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {branches.map((branch, index) => (
        <div key={branch.id} className="flex flex-col gap-4">
          <h4 className="text-sm font-semibold">Sucursal {branch.name || index + 1}</h4>
          <BranchForm defaultValues={branch} canManage={canManage} />
          {index < branches.length - 1 && <div className="border-border border-t" />}
        </div>
      ))}
    </div>
  );
}
