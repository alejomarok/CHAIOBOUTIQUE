-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PERSON', 'COMPANY');

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "businessName" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "documentNumberNormalized" TEXT,
    "taxId" TEXT,
    "taxIdNormalized" TEXT,
    "taxCondition" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "linkedUserId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_address" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "number" TEXT,
    "floor" TEXT,
    "apartment" TEXT,
    "postalCode" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'AR',
    "notes" TEXT,
    "isDefaultShipping" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultBilling" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_code_key" ON "customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_linkedUserId_key" ON "customer"("linkedUserId");

-- CreateIndex
CREATE INDEX "customer_email_idx" ON "customer"("email");

-- CreateIndex
CREATE INDEX "customer_phone_idx" ON "customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customer_documentType_documentNumberNormalized_key" ON "customer"("documentType", "documentNumberNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "customer_taxIdNormalized_key" ON "customer"("taxIdNormalized");

-- CreateIndex
CREATE INDEX "customer_address_customerId_idx" ON "customer_address"("customerId");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written partial unique indexes (not expressible as a plain Prisma
-- @@unique — Postgres would treat every row with isDefaultShipping/
-- isDefaultBilling = false as non-conflicting anyway, but a plain
-- @@unique([customerId, isDefaultShipping]) would additionally block a
-- customer from ever having more than one NON-default address, which is
-- not the intent). Same null-axis/boolean-axis technique as
-- warehouse_default_unique / product_image_primary_unique /
-- cart_active_user_unique — see DATABASE.md "Partial indexes". Enforced
-- alongside modules/customers/customer-core.ts's transactional
-- setDefaultShippingAddress/setDefaultBillingAddress, which unset the old
-- default before setting the new one.
CREATE UNIQUE INDEX customer_address_default_shipping_unique
  ON customer_address("customerId") WHERE "isDefaultShipping" = true;
CREATE UNIQUE INDEX customer_address_default_billing_unique
  ON customer_address("customerId") WHERE "isDefaultBilling" = true;
