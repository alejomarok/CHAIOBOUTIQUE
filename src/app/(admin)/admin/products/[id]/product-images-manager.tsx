"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  deleteProductImageAction,
  reorderProductImageAction,
  setPrimaryImageAction,
  uploadProductImageAction,
} from "./image-actions";

interface ProductImageItem {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
}

const MAX_IMAGE_SIZE_MB = 5;
const MAX_IMAGES_PER_PRODUCT = 10;

export function ProductImagesManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const [altText, setAltText] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
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
    if (confirmingDeleteId !== imageId) {
      setConfirmingDeleteId(imageId);
      return;
    }
    setConfirmingDeleteId(null);
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

  function handleReorder(imageId: string, direction: "up" | "down") {
    startTransition(async () => {
      try {
        await reorderProductImageAction({ imageId, productId, direction });
      } catch {
        toast.error("No pudimos reordenar las imágenes.");
      }
    });
  }

  const atImageLimit = images.length >= MAX_IMAGES_PER_PRODUCT;

  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image, index) => (
            <div key={image.id} className="flex flex-col gap-1.5">
              <div className="bg-muted relative aspect-square overflow-hidden rounded-lg">
                <Image src={image.url} alt={image.altText ?? ""} fill className="object-cover" />
                {image.isPrimary && (
                  <Badge className="absolute top-1 left-1" variant="secondary">
                    Principal
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isPending || index === 0}
                  onClick={() => handleReorder(image.id, "up")}
                  aria-label="Mover antes"
                >
                  ↑
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isPending || index === images.length - 1}
                  onClick={() => handleReorder(image.id, "down")}
                  aria-label="Mover después"
                >
                  ↓
                </Button>
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
                {confirmingDeleteId === image.id ? (
                  <>
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleDelete(image.id)}
                    >
                      Confirmar
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={isPending}
                      onClick={() => setConfirmingDeleteId(null)}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleDelete(image.id)}
                  >
                    Eliminar
                  </Button>
                )}
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
          disabled={atImageLimit}
        />
        <Input
          name="altText"
          placeholder="Texto alternativo (accesibilidad)"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          disabled={atImageLimit}
        />
        <p className="text-muted-foreground text-xs">
          JPG, PNG o WebP, hasta {MAX_IMAGE_SIZE_MB} MB por imagen. Máximo{" "}
          {MAX_IMAGES_PER_PRODUCT} imágenes por producto ({images.length}/{MAX_IMAGES_PER_PRODUCT}{" "}
          usadas). La primera imagen que subís se marca como principal automáticamente.
        </p>
        {atImageLimit ? (
          <p className="text-destructive text-xs">
            Llegaste al máximo de imágenes para este producto. Eliminá una para subir otra.
          </p>
        ) : (
          <Button type="submit" disabled={isPending} className="self-start">
            {isPending ? "Subiendo…" : "Subir imagen"}
          </Button>
        )}
      </form>
    </div>
  );
}
