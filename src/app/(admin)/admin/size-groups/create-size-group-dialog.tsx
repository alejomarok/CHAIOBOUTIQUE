"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { findSimilarSizeGroups, type SizeGroupSummary } from "@/modules/attributes/similarity";

import { createSizeGroupAction } from "./actions";

const formSchema = z.object({
  code: z.string().min(1, "El código es obligatorio"),
  name: z.string().min(1, "El nombre es obligatorio"),
  description: z.string().optional(),
});
type FormInput = z.infer<typeof formSchema>;

export function CreateSizeGroupDialog({
  existingGroups,
}: {
  existingGroups: SizeGroupSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: "", name: "", description: "" },
  });

  // useWatch, not form.watch(): the latter returns a plain function React
  // Compiler can't safely memoize (it skips compiling the whole component
  // when it sees one) — useWatch is the React-Hook-Form-recommended,
  // compiler-friendly way to subscribe to field values reactively.
  const code = useWatch({ control: form.control, name: "code" });
  const name = useWatch({ control: form.control, name: "name" });
  // Non-blocking heads-up only — never prevents submission. See
  // modules/attributes/similarity.ts for the heuristic (shared prefix or
  // bigram overlap), which can't tell a real duplicate from an
  // intentionally similar name — a human decides, this just flags it.
  const similarGroups = useMemo(
    () =>
      code.trim() || name.trim()
        ? findSimilarSizeGroups({ code, name }, existingGroups)
        : [],
    [code, name, existingGroups],
  );

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      const result = await createSizeGroupAction({
        code: values.code,
        name: values.name,
        description: values.description || undefined,
      });
      toast.success("Grupo de talles creado. Ahora podés agregar sus talles.");
      form.reset();
      setOpen(false);
      // Straight to the detail page — creating a group is never the end
      // goal, it exists to hold size options.
      router.push(`/admin/size-groups/${result.id}`);
    } catch {
      toast.error("No pudimos crear el grupo de talles.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Nuevo grupo</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo grupo de talles</DialogTitle>
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
                    <Input placeholder="TOPS, PANTS, FOOTWEAR…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre visible</FormLabel>
                  <FormControl>
                    <Input placeholder="Remeras, Pantalones, Calzado…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {similarGroups.length > 0 && (
              <Alert>
                <TriangleAlert />
                <AlertDescription>
                  Ya existe{similarGroups.length > 1 ? "n" : ""} un grupo parecido:{" "}
                  {similarGroups.map((group) => `${group.name} (${group.code})`).join(", ")}. Si
                  es el mismo grupo, usalo en vez de crear uno nuevo.
                </AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                {isSubmitting ? "Creando…" : "Crear grupo"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
