-- CreateEnum
CREATE TYPE "FiscalTaxCategory" AS ENUM ('IVA_21', 'IVA_10_5', 'IVA_27', 'IVA_5', 'IVA_2_5', 'IVA_0', 'EXENTO');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "taxCategory" "FiscalTaxCategory";

-- AlterTable
ALTER TABLE "sale_item" ADD COLUMN     "taxCategory" "FiscalTaxCategory",
ADD COLUMN     "taxRateBasisPoints" INTEGER;

-- AlterTable
ALTER TABLE "store_configuration" ADD COLUMN     "defaultTaxCategory" "FiscalTaxCategory";
