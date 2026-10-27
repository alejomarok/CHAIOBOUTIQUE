-- AlterTable
ALTER TABLE "store_configuration" ADD COLUMN     "homeDeliveryEstimate" TEXT,
ADD COLUMN     "homeDeliveryPostalCodes" TEXT;

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "policyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "privacyVersion" TEXT,
ADD COLUMN     "termsVersion" TEXT;
