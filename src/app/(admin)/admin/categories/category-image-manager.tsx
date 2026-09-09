"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { optimizeImageForUpload, validateSelectedImageFile } from "@/lib/image-optimize";

import { deleteCategoryImageAction, finalizeCategoryImageUploadAction, prepareCategoryImageUploadAction } from "./image-actions";

// Mirrors product-images-manager.tsx's direct-to-Supabase upload flow
// (prepare -> PUT -> finalize), simplified for a single image instead of a
// list: no reordering/"set primary", and a new selection always REPLACES
// the current image rather than adding to it. See
// modules/categories/category-images.ts's own comment for the exact
// replace/delete ordering this drives.
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

export function CategoryImageManager({
  categoryId,
  currentImageUrl,
  currentAltText,
  canManage,
}: {
  categoryId: string;
  currentImageUrl: string | null;
  currentAltText: string | null;
  canManage: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [altText, setAltText] = useState(currentAltText ?? "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A local, client-only preview of the file about to be uploaded — never
  // the real server URL, which doesn't exist until the upload succeeds.
  const previewUrl = useMemo(() => (selectedFile ? URL.createObjectURL(selectedFile) : null), [selectedFile]);
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
      const optimized = await optimizeImageForUpload(selectedFile);

      const prepared = await prepareCategoryImageUploadAction({
        categoryId,
        filename: optimized.file.name,
        contentType: optimized.file.type,
        fileSize: optimized.file.size,
      });

      await putToSignedUrl(prepared.signedUrl, optimized.file, setUploadProgress);

      // Confirms with the server: validates the actual uploaded object,
      // then — since a Category has at most one image — this call REPLACES
      // whatever was there before (see finalizeCategoryImageUpload's own
      // "upload new -> validate -> update DB -> delete old" ordering).
      await finalizeCategoryImageUploadAction({
        categoryId,
        bucket: prepared.bucket,
        path: prepared.path,
        contentType: optimized.file.type,
        altText: altText || null,
      });

      toast.success(currentImageUrl ? "Imagen actualizada." : "Imagen subida correctamente.");
      resetFileSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir la imagen. Intentá nuevamente.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setIsDeleting(true);
    deleteCategoryImageAction({ categoryId })
      .then(() => toast.success("Imagen eliminada."))
      .catch(() => toast.error("No pudimos eliminar la imagen."))
      .finally(() => setIsDeleting(false));
  }

  const busy = isUploading || isDeleting;

  return (
    <div className="flex flex-col gap-4">
      {currentImageUrl && !selectedFile && (
        <div className="flex items-center gap-3">
          <div className="bg-muted relative size-24 shrink-0 overflow-hidden rounded-lg">
            <Image src={currentImageUrl} alt={currentAltText ?? ""} fill sizes="96px" className="object-cover" />
          </div>
          {canManage && (
            <div className="flex flex-col gap-1">
              {confirmingDelete ? (
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" size="xs" disabled={busy} onClick={handleDelete}>
                    Confirmar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="xs" disabled={busy} onClick={handleDelete}>
                  {isDeleting ? "Eliminando…" : "Eliminar imagen"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {!currentImageUrl && !selectedFile && (
        <p className="text-muted-foreground text-sm">Esta categoría todavía no tiene imagen.</p>
      )}

      {canManage && (
        <form onSubmit={handleUpload} className="border-border flex flex-col gap-2 rounded-lg border p-3">
          <Input
            ref={fileInputRef}
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={isUploading}
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
          <Input
            name="altText"
            placeholder="Texto alternativo (accesibilidad)"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            disabled={isUploading}
          />
          <p className="text-muted-foreground text-xs">
            JPG, PNG o WebP. La imagen se optimiza automáticamente antes de subirse.
            {currentImageUrl && " Subir una nueva imagen reemplaza la actual."}
          </p>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isUploading || !selectedFile} className="self-start">
              {isUploading ? "Subiendo imagen…" : currentImageUrl ? "Cambiar imagen" : "Subir imagen"}
            </Button>
            {isUploading && uploadProgress > 0 && (
              <div className="bg-muted h-1.5 w-32 overflow-hidden rounded-full">
                <div className="bg-primary h-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
