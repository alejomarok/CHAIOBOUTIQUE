"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { updateSizeOptionAction } from "../actions";

const formSchema = z.object({
  code: z.string().min(1, "El código es obligatorio"),
  label: z.string().min(1, "El nombre visible es obligatorio"),
  sortOrder: z.string().min(1, "El orden es obligatorio"),
});
type FormInput = z.infer<typeof formSchema>;

export function EditSizeOptionDialog({
  sizeGroupId,
  option,
}: {
  sizeGroupId: string;
  option: { id: string; code: string; label: string; sortOrder: number };
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: option.code,
      label: option.label,
      sortOrder: String(option.sortOrder),
    },
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      await updateSizeOptionAction({
        id: option.id,
        sizeGroupId,
        code: values.code,
        label: values.label,
        sortOrder: Number(values.sortOrder),
      });
      toast.success("Talle actualizado.");
      setOpen(false);
    } catch {
      toast.error("No pudimos actualizar el talle. Verificá que el código y el nombre no estén repetidos.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset({ code: option.code, label: option.label, sortOrder: String(option.sortOrder) });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar talle</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código interno</FormLabel>
                  <FormControl>
                    <Input placeholder="36, S, M, XL…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre visible</FormLabel>
                  <FormControl>
                    <Input placeholder="36, S, M, XL…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Orden</FormLabel>
                  <FormControl>
                    <Input type="number" step={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Guardando…" : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
