"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  deleteProductImageAction,
  setPrimaryImageAction,
  uploadProductImageAction,
} from "./image-actions";

interface ProductImageItem {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
}

export function ProductImagesManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const [altText, setAltText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleUpload(formData: FormData) {
    startTransition(async () => {
      try {
        await uploadProductImageAction(productId, formData);
        toast.success("Imagen subida.");
        setAltText("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos subir la imagen.");
      }
    });
  }

  function handleDelete(imageId: string) {
    startTransition(async () => {
      try {
        await deleteProductImageAction({ imageId, productId });
        toast.success("Imagen eliminada.");
      } catch {
        toast.error("No pudimos eliminar la imagen.");
      }
    });
  }

  function handleSetPrimary(imageId: string) {
    startTransition(async () => {
      try {
        await setPrimaryImageAction({ imageId, productId });
        toast.success("Imagen principal actualizada.");
      } catch {
        toast.error("No pudimos actualizar la imagen principal.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image) => (
            <div key={image.id} className="flex flex-col gap-1.5">
              <div className="bg-muted relative aspect-square overflow-hidden rounded-lg">
                <Image src={image.url} alt={image.altText ?? ""} fill className="object-cover" />
                {image.isPrimary && (
                  <Badge className="absolute top-1 left-1" variant="secondary">
                    Principal
                  </Badge>
                )}
              </div>
              <div className="flex gap-1">
                {!image.isPrimary && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleSetPrimary(image.id)}
                  >
                    Hacer principal
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isPending}
                  onClick={() => handleDelete(image.id)}
                >
                  Eliminar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        action={handleUpload}
        className="border-border flex flex-col gap-2 rounded-lg border p-3"
      >
        <Input
          ref={fileInputRef}
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
        />
        <Input
          name="altText"
          placeholder="Texto alternativo (accesibilidad)"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
        />
        <Button type="submit" disabled={isPending} className="self-start">
          {isPending ? "Subiendo…" : "Subir imagen"}
        </Button>
      </form>
    </div>
  );
}
