-- CreateIndex
CREATE INDEX "sale_createdById_idx" ON "sale"("createdById");

-- CreateIndex
CREATE INDEX "sale_item_productVariantId_idx" ON "sale_item"("productVariantId");
