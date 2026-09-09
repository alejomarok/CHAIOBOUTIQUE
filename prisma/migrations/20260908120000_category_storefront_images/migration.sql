-- Phase: Admin-Controlled Category Images. Adds the storefront image
-- metadata columns to Category — see that model's own schema comment for
-- why these live directly on Category (a single admin-controlled
-- storefront image per category, metadata only, mirroring ProductImage's
-- bucket/path posture; the binary content lives in Supabase Storage, never
-- a permanent URL in this table). Purely additive: every column is
-- nullable, every existing Category row is preserved unchanged (all three
-- new columns simply start NULL, which the application already treats as
-- "no image configured yet" — see components/home/category-tiles.tsx's
-- fallback priority). No destructive statement of any kind.

-- AlterTable
ALTER TABLE "category" ADD COLUMN     "imageAltText" TEXT,
ADD COLUMN     "imageBucket" TEXT,
ADD COLUMN     "imagePath" TEXT;
