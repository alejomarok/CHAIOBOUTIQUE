/*
  Warnings:

  - Added the required column `warehouseId` to the `sale` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- IF NOT EXISTS (Postgres 9.6+): ALTER TYPE ... ADD VALUE commits
-- independently of the surrounding migration transaction and is NOT rolled
-- back if a later statement in the same migration.sql fails — confirmed
-- directly against this exact migration, whose first apply attempt failed
-- on the later "sale.warehouseId NOT NULL" statement (pre-existing test
-- rows) but still left these enum values permanently added. IF NOT EXISTS
-- makes a retry (or a second environment where this was already applied
-- another way) safe either way.
ALTER TYPE "InventoryOperationType" ADD VALUE IF NOT EXISTS 'SALE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'SALE';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'SALE_CANCELLATION';

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "warehouseId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "sale_warehouseId_idx" ON "sale"("warehouseId");

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
