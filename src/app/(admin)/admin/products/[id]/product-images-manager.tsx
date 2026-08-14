"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { optimizeImageForUpload, validateSelectedImageFile } from "@/lib/image-optimize";

import {
  deleteProductImageAction,
  finalizeProductImageUploadAction,
  prepareProductImageUploadAction,
  reorderProductImageAction,
  setPrimaryImageAction,
} from "./image-actions";

interface ProductImageItem {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
}

// Mirrors modules/products/product-images.ts's own constant — a mismatch
// here would only affect when the "Llegaste al máximo" message shows a
// beat early/late client-side; the server is what actually enforces it.
const MAX_IMAGES_PER_PRODUCT = 10;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Uploads directly to Supabase Storage's signed URL — a plain XHR (not
// fetch) specifically so upload progress is observable; fetch has no
// upload-progress event. Rejects with a friendly Spanish message on any
// non-2xx response or network failure, never a raw browser/XHR error.
function putToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
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

export function ProductImagesManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [altText, setAltText] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A local, client-only preview of the file about to be uploaded — never
  // the actual server URL, which doesn't exist until the upload succeeds.
  const previewUrl = useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : null),
    [selectedFile],
  );
  // Revoked on every change/unmount so selecting several files in a row (or
  // navigating away) never leaks object URLs.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function resetFileSelection() {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      // Immediate, friendly feedback before even trying to process the
      // file — required behavior 3B.
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

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile || isUploading) return;

    setIsUploading(true);
    setUploadProgress(0);
    try {
      // 1. Client-side resize/compress — see lib/image-optimize.ts for the
      // exact target dimensions/quality. This is what keeps a normal phone
      // photo from ever coming close to the server-side size limit.
      const optimized = await optimizeImageForUpload(selectedFile);

      // 2. Ask the server to authorize the upload and hand back a signed,
      // path-scoped upload target. The file's bytes haven't gone anywhere
      // yet.
      const prepared = await prepareProductImageUploadAction({
        productId,
        filename: optimized.file.name,
        contentType: optimized.file.type,
        fileSize: optimized.file.size,
      });

      // 3. Upload directly to Supabase Storage — this server never
      // receives the bytes.
      await putToSignedUrl(prepared.signedUrl, optimized.file, setUploadProgress);

      // 4. Confirm with the server: validates the actual uploaded object
      // and creates the ProductImage row.
      await finalizeProductImageUploadAction({
        productId,
        bucket: prepared.bucket,
        path: prepared.path,
        contentType: optimized.file.type,
        altText: altText || null,
      });

      toast.success("Imagen subida correctamente.");
      setAltText("");
      resetFileSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir la imagen. Intentá nuevamente.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
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
  const busy = isPending || isUploading;

  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image, index) => (
            <div key={image.id} className="flex flex-col gap-1.5">
              <div className="bg-muted relative aspect-square overflow-hidden rounded-lg">
                <Image
                  src={image.url}
                  alt={image.altText ?? ""}
                  fill
                  sizes="(min-width: 640px) 224px, 33vw"
                  className="object-cover"
                />
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
                  disabled={busy || index === 0}
                  onClick={() => handleReorder(image.id, "up")}
                  aria-label="Mover antes"
                >
                  ↑
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || index === images.length - 1}
                  onClick={() => handleReorder(image.id, "down")}
                  aria-label="Mover después"
                >
                  ↓
                </Button>
                {!image.isPrimary && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
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
                      disabled={busy}
                      onClick={() => handleDelete(image.id)}
                    >
                      Confirmar
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() => setConfirmingDeleteId(null)}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
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

      <form onSubmit={handleUpload} className="border-border flex flex-col gap-2 rounded-lg border p-3">
        <Input
          ref={fileInputRef}
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
          disabled={atImageLimit || isUploading}
          onChange={handleFileChange}
        />
        {selectedFile && previewUrl && (
          <div className="flex items-center gap-3">
            <div className="bg-muted relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element -- a
                  transient blob: URL preview, not a real product image;
                  next/image's remote-pattern allowlist doesn't cover it and
                  doesn't need to for a local-only preview. */}
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-sm break-all">{selectedFile.name}</p>
              <p className="text-muted-foreground text-xs">{formatFileSize(selectedFile.size)}</p>
            </div>
          </div>
        )}
        <Input
          name="altText"
          placeholder="Texto alternativo (accesibilidad)"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          disabled={atImageLimit || isUploading}
        />
        <p className="text-muted-foreground text-xs">
          JPG, PNG o WebP. Las fotos se optimizan automáticamente antes de subirse. Máximo{" "}
          {MAX_IMAGES_PER_PRODUCT} imágenes por producto ({images.length}/{MAX_IMAGES_PER_PRODUCT}{" "}
          usadas). La primera imagen que subís se marca como principal automáticamente.
        </p>
        {atImageLimit ? (
          <p className="text-destructive text-xs">
            Llegaste al máximo de imágenes para este producto. Eliminá una para subir otra.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isUploading || !selectedFile} className="self-start">
              {isUploading ? "Subiendo imagen…" : "Subir imagen"}
            </Button>
            {isUploading && uploadProgress > 0 && (
              <div className="bg-muted h-1.5 w-32 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
