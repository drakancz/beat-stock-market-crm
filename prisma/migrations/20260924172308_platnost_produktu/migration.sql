-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "renewalLeadDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "renewalUserId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "validityMonths" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "validityMonths" INTEGER;

-- CreateTable
CREATE TABLE "product_validities" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "manualUntil" TIMESTAMP(3),
    "manualAt" TIMESTAMP(3),
    "reminderTaskId" TEXT,
    "reminderForUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_validities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_validities_reminderTaskId_key" ON "product_validities"("reminderTaskId");

-- CreateIndex
CREATE INDEX "product_validities_validUntil_idx" ON "product_validities"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "product_validities_clientId_productId_key" ON "product_validities"("clientId", "productId");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_renewalUserId_fkey" FOREIGN KEY ("renewalUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_validities" ADD CONSTRAINT "product_validities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_validities" ADD CONSTRAINT "product_validities_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_validities" ADD CONSTRAINT "product_validities_reminderTaskId_fkey" FOREIGN KEY ("reminderTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
