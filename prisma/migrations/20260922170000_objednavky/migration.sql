-- Z obchodních případů se staly objednávky (Jakub, 22. 9. 2026).
--
-- Případ rozjednával obchodník a posouval ho fázemi; objednávku vytvoří
-- klient sám na Landing Page a CRM u ní sleduje jen platbu a přístup
-- do programu.
--
-- **Stará data se ruší, ne převádějí.** Jakub to tak rozhodl 22. 9. 2026 —
-- v databázi byly jen ukázkové případy ze seedu, žádné skutečné
-- objednávky. Tabulky `deals` a `deal_items` proto mizí i s obsahem.
--
-- Broker se u objednávky nevede vůbec (sloupec `brokerId` je pryč);
-- portfolia klientů u brokerů zůstávají beze změny.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NOVA', 'NEZAPLACENO', 'ZAPLACENO');

-- CreateEnum
CREATE TYPE "ProgramAccess" AS ENUM ('NEPOVOLEN', 'POVOLEN');

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_dealId_fkey";

-- DropForeignKey
ALTER TABLE "deal_items" DROP CONSTRAINT "deal_items_dealId_fkey";

-- DropForeignKey
ALTER TABLE "deal_items" DROP CONSTRAINT "deal_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_brokerId_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_clientId_fkey";

-- DropIndex
DROP INDEX "calls_dealId_idx";

-- AlterTable
ALTER TABLE "calls" DROP COLUMN "dealId",
ADD COLUMN     "orderId" TEXT;

-- DropTable
DROP TABLE "deal_items";

-- DropTable
DROP TABLE "deals";

-- DropEnum
DROP TYPE "DealStage";

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NOVA',
    "programAccess" "ProgramAccess" NOT NULL DEFAULT 'NEPOVOLEN',
    "currency" CHAR(3) NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_clientId_idx" ON "orders"("clientId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_productId_key" ON "order_items"("orderId", "productId");

-- CreateIndex
CREATE INDEX "calls_orderId_idx" ON "calls"("orderId");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

