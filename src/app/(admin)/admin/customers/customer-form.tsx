"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { createCustomerAction, updateCustomerAction } from "./actions";

const formSchema = z.object({
  type: z.enum(["PERSON", "COMPANY"]),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  businessName: z.string().optional(),
  documentType: z.string().optional(),
  documentNumber: z.string().optional(),
  taxId: z.string().optional(),
  taxCondition: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});
type FormInput = z.infer<typeof formSchema>;

interface DuplicateMatch {
  id: string;
  displayName: string;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerFormProps {
  customerId?: string;
  defaultValues?: Partial<FormInput>;
}

const TAX_CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable Inscripto",
  MONOTRIBUTO: "Monotributo",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  NO_RESPONSABLE: "No Responsable",
};

// react-hook-form keeps every registered field's value even while its
// FormField isn't rendered (no shouldUnregister), so switching between
// PERSON/COMPANY never loses what was typed if the admin switches back —
// the server is what actually enforces which fields apply to which type
// (see modules/customers/customer-core.ts's createCustomer/updateCustomer),
// this form only decides what to *show*.
export function CustomerForm({ customerId, defaultValues }: CustomerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [pendingValues, setPendingValues] = useState<FormInput | null>(null);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "PERSON",
      firstName: "",
      lastName: "",
      businessName: "",
      documentType: "DNI",
      documentNumber: "",
      taxId: "",
      taxCondition: "",
      email: "",
      phone: "",
      notes: "",
      ...defaultValues,
    },
  });

  // useWatch, not form.watch(): the latter returns a plain function React
  // Compiler can't safely memoize (it skips compiling the whole component
  // when it sees one) — useWatch is the React-Hook-Form-recommended,
  // compiler-friendly way to subscribe to field values reactively. See
  // app/(admin)/admin/size-groups/create-size-group-dialog.tsx for the same
  // pattern.
  const type = useWatch({ control: form.control, name: "type" });

  async function submit(values: FormInput, confirmed: boolean) {
    setIsSubmitting(true);
    try {
      const result = customerId
        ? await updateCustomerAction(customerId, { ...values, confirmed })
        : await createCustomerAction({ ...values, confirmed });

      if (result.status === "possible_duplicates") {
        setDuplicates(result.matches);
        setPendingValues(values);
        return;
      }

      setDuplicates(null);
      setPendingValues(null);
      toast.success(customerId ? "Cliente actualizado." : "Cliente creado.");
      router.push(`/admin/customers/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos guardar el cliente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmit(values: FormInput) {
    await submit(values, false);
  }

  async function onContinueAnyway() {
    if (!pendingValues) return;
    await submit(pendingValues, true);
  }

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo de cliente</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="PERSON">Persona</SelectItem>
                    <SelectItem value="COMPANY">Empresa</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {type === "PERSON" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
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
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Apellido</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ) : (
            <FormField
              control={form.control}
              name="businessName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razón social</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {type === "PERSON" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="documentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de documento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="DNI">DNI</SelectItem>
                        <SelectItem value="PASSPORT">Pasaporte</SelectItem>
                        <SelectItem value="OTHER">Otro</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="documentNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de documento (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="30.123.456" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="taxId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CUIT (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="20-12345678-9" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="taxCondition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Condición fiscal (opcional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Sin especificar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(TAX_CONDITION_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (opcional)</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="11 5555-5555" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notas internas (opcional)</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? "Guardando…" : customerId ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </form>
      </Form>

      <Dialog open={duplicates !== null} onOpenChange={(open) => !open && setDuplicates(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encontramos un cliente que podría ser el mismo</DialogTitle>
            <DialogDescription>
              Revisá si alguno de estos clientes ya existentes es la misma persona antes de
              continuar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {duplicates?.map((match) => (
              <div key={match.id} className="border-border rounded-lg border p-3 text-sm">
                <p className="font-medium">{match.displayName}</p>
                {match.documentNumber && (
                  <p className="text-muted-foreground">Documento {match.documentNumber}</p>
                )}
                {match.email && <p className="text-muted-foreground">{match.email}</p>}
                {match.phone && <p className="text-muted-foreground">{match.phone}</p>}
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href={`/admin/customers/${match.id}`} target="_blank">
                    Ver cliente existente ↗
                  </Link>
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicates(null)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={onContinueAnyway} disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Continuar de todos modos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
