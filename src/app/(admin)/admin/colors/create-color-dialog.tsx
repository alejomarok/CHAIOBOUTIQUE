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

import { createColorAction } from "./actions";

const formSchema = z.object({
  key: z.string().min(1, "La clave es obligatoria"),
  displayName: z.string().min(1, "El nombre es obligatorio"),
  hexPrimary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Formato hexadecimal inválido (#rrggbb)")
    .optional()
    .or(z.literal("")),
});
type FormInput = z.infer<typeof formSchema>;

export function CreateColorDialog() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { key: "", displayName: "", hexPrimary: "" },
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      await createColorAction({
        key: values.key,
        displayName: values.displayName,
        hexPrimary: values.hexPrimary || undefined,
      });
      toast.success("Color creado.");
      form.reset();
      setOpen(false);
    } catch {
      toast.error("No pudimos crear el color.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Nuevo color</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo color</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clave interna</FormLabel>
                  <FormControl>
                    <Input placeholder="negro, blanco…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre visible</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hexPrimary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color (ayuda visual, opcional)</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="#000000" {...field} />
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
                {isSubmitting ? "Creando…" : "Crear color"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
