-- Sazby DPH a ceny bez DPH (Jakub, 10. 9. 2026).
--
-- Psáno ručně: Prisma by sloupec s cenou zahodila a založila nový, čímž
-- by ceny v ceníku zmizely. Tady se sloupec přejmenuje a ceny převedou.

-- CreateTable
CREATE TABLE "vat_rates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "order" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_rates_pkey" PRIMARY KEY ("id")
);

-- Sazby jsou vždycky tři. Administrátor mění jejich název a výši
-- v Nastavení, nepřidává ani nemaže — proto vznikají tady.
INSERT INTO "vat_rates" ("id", "name", "rate", "order", "updatedAt") VALUES
    ('zakladni', 'Základní', 21.00, 1, CURRENT_TIMESTAMP),
    ('snizena', 'Snížená', 12.00, 2, CURRENT_TIMESTAMP),
    ('nulova', 'Nulová', 0.00, 3, CURRENT_TIMESTAMP);

-- Dosavadní ceny byly zadané **včetně DPH 21 %**. Převádějí se na cenu
-- bez DPH tak, aby cena, kterou platí klient, zůstala stejná.
ALTER TABLE "products" RENAME COLUMN "price" TO "netPrice";
UPDATE "products" SET "netPrice" = ROUND("netPrice" / 1.21, 2);

-- Všechny dosavadní produkty jsou v základní sazbě. Výchozí hodnota je jen
-- na dobu převodu — nový produkt musí mít sazbu vybranou.
ALTER TABLE "products" ADD COLUMN "vatRateId" TEXT NOT NULL DEFAULT 'zakladni';
ALTER TABLE "products" ALTER COLUMN "vatRateId" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "vat_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aktivita uživatelů.

-- CreateEnum
CREATE TYPE "UserEventKind" AS ENUM ('PRIHLASENI', 'NEUSPESNE_PRIHLASENI', 'ODHLASENI', 'ZOBRAZENI');

-- CreateTable
CREATE TABLE "user_events" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "kind" "UserEventKind" NOT NULL,
    "path" TEXT,
    "clientId" TEXT,
    "detail" TEXT,

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_events_at_idx" ON "user_events"("at");

-- CreateIndex
CREATE INDEX "user_events_userId_at_idx" ON "user_events"("userId", "at");

-- CreateIndex
CREATE INDEX "user_events_clientId_idx" ON "user_events"("clientId");

-- AddForeignKey
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
