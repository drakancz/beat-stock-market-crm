-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_brokerId_fkey";

-- DropIndex
DROP INDEX "deals_brokerId_idx";

-- AlterTable
ALTER TABLE "deal_items" DROP COLUMN "name",
DROP COLUMN "purchasePrice",
DROP COLUMN "ticker",
ADD COLUMN     "productId" TEXT NOT NULL,
ALTER COLUMN "quantity" SET DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "deals" DROP COLUMN "brokerId";

-- CreateIndex
CREATE UNIQUE INDEX "deal_items_dealId_productId_key" ON "deal_items"("dealId", "productId");

-- AddForeignKey
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

