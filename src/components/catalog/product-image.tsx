"use client";

import Image from "next/image";
import { useState } from "react";

// Local, always-available fallback — never a remote URL, so it can never
// itself be the thing that's broken/missing. Used both when a product has
// no image at all (primaryImageUrl/url is null) and when a remote
// Supabase Storage URL fails to load (object deleted out-of-band, bucket
// briefly unreachable, etc.) — see DATABASE.md "Public visibility": having
// no image is never a reason to hide an otherwise-valid product.
const PLACEHOLDER_SRC = "/images/product-placeholder.svg";

export function ProductImage({
  src,
  alt,
  className,
  sizes,
  priority,
}: {
  src: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [trackedSrc, setTrackedSrc] = useState(src);

  // A prop change (e.g. the primary image was swapped) must not keep
  // showing the placeholder from a previous, unrelated load failure.
  // Adjusting state during render (React's documented pattern for
  // "resetting state when a prop changes") instead of an Effect, so this
  // never causes an extra commit.
  if (src !== trackedSrc) {
    setTrackedSrc(src);
    setFailed(false);
  }

  const resolvedSrc = src && !failed ? src : PLACEHOLDER_SRC;

  return (
    <Image
      src={resolvedSrc}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
