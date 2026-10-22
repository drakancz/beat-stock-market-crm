-- Slevové kódy (Fáze 5A, Jakub 14. 10. 2026). Jen přidává — žádná data se nemění.

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PROCENTA', 'CASTKA');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "listNetPrice" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountCodeId" TEXT;

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "note" VARCHAR(200),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "maxUses" INTEGER,
    "oncePerClient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_code_products" (
    "codeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "discount_code_products_pkey" PRIMARY KEY ("codeId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_code_products_productId_idx" ON "discount_code_products"("productId");

-- CreateIndex
CREATE INDEX "orders_discountCodeId_idx" ON "orders"("discountCodeId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_products" ADD CONSTRAINT "discount_code_products_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_products" ADD CONSTRAINT "discount_code_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
