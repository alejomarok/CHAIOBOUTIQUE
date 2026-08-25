-- CreateEnum
CREATE TYPE "IssuerVatCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO');

-- CreateEnum
CREATE TYPE "RecipientVatCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO', 'CONSUMIDOR_FINAL', 'IVA_NO_ALCANZADO');

-- CreateEnum
CREATE TYPE "ArcaEnvironment" AS ENUM ('HOMOLOGATION', 'PRODUCTION');

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "vatCondition" "RecipientVatCondition";

-- AlterTable
ALTER TABLE "store_configuration" DROP COLUMN "fiscalTaxCondition",
ADD COLUMN     "arcaEnvironment" "ArcaEnvironment",
ADD COLUMN     "arcaPointOfSale" INTEGER,
ADD COLUMN     "fiscalActivityStartDate" TIMESTAMP(3),
ADD COLUMN     "fiscalAddress" TEXT,
ADD COLUMN     "fiscalGrossIncomeId" TEXT,
ADD COLUMN     "issuerVatCondition" "IssuerVatCondition";
