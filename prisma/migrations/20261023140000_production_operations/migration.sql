-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SalePaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "SalePaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "SalePaymentStatus" ADD VALUE 'CHARGED_BACK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderPaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'CHARGED_BACK';

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "chargebackAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAmount" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "accessTokenEncrypted" TEXT,
ADD COLUMN     "checkoutCartId" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingCarrier" TEXT,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingUrl" TEXT;

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_rate_limit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_rate_limit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "provider_payment_adjustment" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_payment_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "orderId" TEXT,
    "recipient" TEXT,
    "encryptedPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_request" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "orderCode" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit"("key");

-- CreateIndex
CREATE INDEX "rate_limit_lastRequest_idx" ON "rate_limit"("lastRequest");

-- CreateIndex
CREATE INDEX "app_rate_limit_expiresAt_idx" ON "app_rate_limit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_payment_adjustment_eventKey_key" ON "provider_payment_adjustment"("eventKey");

-- CreateIndex
CREATE INDEX "provider_payment_adjustment_saleId_idx" ON "provider_payment_adjustment"("saleId");

-- CreateIndex
CREATE INDEX "provider_payment_adjustment_orderId_idx" ON "provider_payment_adjustment"("orderId");

-- CreateIndex
CREATE INDEX "provider_payment_adjustment_providerPaymentId_kind_idx" ON "provider_payment_adjustment"("providerPaymentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_eventKey_key" ON "email_outbox"("eventKey");

-- CreateIndex
CREATE INDEX "email_outbox_status_availableAt_idx" ON "email_outbox"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_request_code_key" ON "consumer_request"("code");

-- CreateIndex
CREATE INDEX "consumer_request_status_createdAt_idx" ON "consumer_request"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "provider_payment_adjustment" ADD CONSTRAINT "provider_payment_adjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_payment_adjustment" ADD CONSTRAINT "provider_payment_adjustment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_payment_adjustment" ADD CONSTRAINT "positive_adjustment" CHECK (amount > 0 AND kind IN ('REFUND', 'CHARGEBACK'));
CREATE TRIGGER provider_payment_adjustment_append_only BEFORE UPDATE OR DELETE ON "provider_payment_adjustment"
FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
ALTER TABLE "sale" ADD CONSTRAINT "sale_adjustments_nonnegative" CHECK ("refundedAmount" >= 0 AND "chargebackAmount" >= 0 AND "paidAmount" >= 0);
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_state" CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED') AND attempts >= 0);
ALTER TABLE "consumer_request" ADD CONSTRAINT "consumer_request_state" CHECK (status IN ('PENDING', 'PROCESSING', 'RESOLVED', 'REJECTED') AND kind IN ('WITHDRAWAL', 'EXCHANGE', 'PRIVACY'));
