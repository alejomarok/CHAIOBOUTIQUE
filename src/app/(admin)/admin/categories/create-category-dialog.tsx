"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { optimizeImageForUpload, validateSelectedImageFile } from "@/lib/image-optimize";

import { createCategoryAction } from "./actions";
import { finalizeCategoryImageUploadAction, prepareCategoryImageUploadAction } from "./image-actions";

// Same direct-to-Supabase PUT as category-image-manager.tsx.
function putToSignedUrl(signedUrl: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("No se pudo subir la imagen. Intentá nuevamente."));
    };
    xhr.onerror = () => reject(new Error("No se pudo subir la imagen. Revisá tu conexión e intentá de nuevo."));
    xhr.send(file);
  });
}

const formSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  parentId: z.string().optional(),
  description: z.string().optional(),
  defaultSizeGroupId: z.string().optional(),
  showInStorefrontNav: z.boolean(),
});
type FormInput = z.infer<typeof formSchema>;

export function CreateCategoryDialog({
  categories,
  sizeGroups,
}: {
  categories: { id: string; name: string }[];
  sizeGroups: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Remounts the (uncontrolled) file <Input> to clear its selection —
  // deliberately not a ref: the reset needs to happen from inside
  // onSubmit's closure (invoked via form.handleSubmit(onSubmit), a
  // function CALL evaluated inline in JSX), and react-hooks/refs flags any
  // ref read reachable from there as a potential render-time access. A
  // state-driven remount key sidesteps the ambiguity entirely rather than
  // fighting the linter.
  const [fileInputKey, setFileInputKey] = useState(0);

  const previewUrl = useMemo(() => (selectedFile ? URL.createObjectURL(selectedFile) : null), [selectedFile]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      parentId: "",
      description: "",
      defaultSizeGroupId: "",
      showInStorefrontNav: false,
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      const validationError = validateSelectedImageFile(file);
      if (validationError) {
        toast.error(validationError);
        e.target.value = "";
        setSelectedFile(null);
        return;
      }
    }
    setSelectedFile(file);
  }

  function resetAll() {
    form.reset();
    setSelectedFile(null);
    setFileInputKey((key) => key + 1);
  }

  // Two-step workflow (this phase's explicit requirement): the category's
  // id doesn't exist before creation, so the image — if one was selected —
  // can only be uploaded AFTER createCategoryAction returns it. If that
  // second step fails, the category itself is NOT rolled back/deleted: it
  // was created successfully, and the admin can add the image later from
  // the edit screen — see the specific required message below.
  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      const { id: categoryId } = await createCategoryAction({
        name: values.name,
        parentId: values.parentId || undefined,
        description: values.description || undefined,
        defaultSizeGroupId: values.defaultSizeGroupId || undefined,
        showInStorefrontNav: values.showInStorefrontNav,
      });

      if (selectedFile) {
        try {
          const optimized = await optimizeImageForUpload(selectedFile);
          const prepared = await prepareCategoryImageUploadAction({
            categoryId,
            filename: optimized.file.name,
            contentType: optimized.file.type,
            fileSize: optimized.file.size,
          });
          await putToSignedUrl(prepared.signedUrl, optimized.file, () => {});
          await finalizeCategoryImageUploadAction({
            categoryId,
            bucket: prepared.bucket,
            path: prepared.path,
            contentType: optimized.file.type,
          });
          toast.success("Categoría creada.");
        } catch {
          toast.error(
            "La categoría fue creada, pero no pudimos subir la imagen. Podés volver a intentarlo desde Editar.",
          );
        }
      } else {
        toast.success("Categoría creada.");
      }

      resetAll();
      setOpen(false);
    } catch {
      toast.error("No pudimos crear la categoría.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetAll();
      }}
    >
      <DialogTrigger asChild>
        <Button>Nueva categoría</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva categoría</DialogTitle>
        </DialogHeader>
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
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría padre (opcional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Sin categoría padre" />
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
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
                  <Select onValueChange={field.onChange} value={field.value}>
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
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Imagen de categoría (opcional)</p>
              <Input
                key={fileInputKey}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={isSubmitting}
                onChange={handleFileChange}
              />
              {selectedFile && previewUrl && (
                <div className="flex items-center gap-3">
                  <div className="bg-muted relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a
                        transient blob: URL preview, not a real category image. */}
                    <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <p className="text-sm break-all">{selectedFile.name}</p>
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                JPG, PNG o WebP. Se usa en la portada de la tienda. Podés agregarla o cambiarla después
                desde Editar.
              </p>
            </div>
            <FormField
              control={form.control}
              name="showInStorefrontNav"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="flex flex-col gap-1">
                    <FormLabel className="font-normal">Mostrar en navegación pública</FormLabel>
                    <p className="text-muted-foreground text-xs">
                      Aparece en el menú y en &quot;Explorá por categoría&quot; de la tienda. Podés
                      cambiarlo después.
                    </p>
                  </div>
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
                {isSubmitting ? "Creando…" : "Crear categoría"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
