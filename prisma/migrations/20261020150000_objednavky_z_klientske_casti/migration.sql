-- Objednávky z klientské části (Jakub, 20. 10. 2026): odkud objednávka
-- přišla. Jen přidává; dosavadní objednávky jsou z Landing Page.

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('LANDING_PAGE', 'KLIENTSKA_CAST');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'LANDING_PAGE';
