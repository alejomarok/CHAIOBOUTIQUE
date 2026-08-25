-- CreateEnum
CREATE TYPE "PaymentAttemptProvider" AS ENUM ('MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED_RECONCILIATION', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "paymentReviewReason" TEXT,
ADD COLUMN     "requiresPaymentReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "isSystemAccount" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "order_payment_attempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentAttemptProvider" NOT NULL DEFAULT 'MERCADO_PAGO',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "providerPreferenceId" TEXT,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "idempotencyKey" TEXT,
    "failureCode" TEXT,
    "failureDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "order_payment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_payment_attempt_providerPreferenceId_key" ON "order_payment_attempt"("providerPreferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "order_payment_attempt_providerPaymentId_key" ON "order_payment_attempt"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "order_payment_attempt_idempotencyKey_key" ON "order_payment_attempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "order_payment_attempt_orderId_status_idx" ON "order_payment_attempt"("orderId", "status");

-- CreateIndex
CREATE INDEX "order_payment_attempt_orderId_createdAt_idx" ON "order_payment_attempt"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_requiresPaymentReview_idx" ON "order"("requiresPaymentReview");

-- CreateIndex
CREATE UNIQUE INDEX "sale_orderId_key" ON "sale"("orderId");

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payment_attempt" ADD CONSTRAINT "order_payment_attempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
