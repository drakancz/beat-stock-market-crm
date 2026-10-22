-- Připomínka nezaplacené objednávky (Fáze 5A, Jakub 11. 10. 2026).
-- Přidává sloupce, nic nemaže.

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "paymentReminderFirstDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "paymentReminderSecondDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "paymentReminderUserId" TEXT,
ADD COLUMN     "paymentRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentRemindedAt" TIMESTAMP(3),
ADD COLUMN     "paymentReminderDelivery" VARCHAR(20),
ADD COLUMN     "paymentReminderTaskId" TEXT,
ADD COLUMN     "paymentReminders" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "orders_paymentReminderTaskId_key" ON "orders"("paymentReminderTaskId");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_paymentReminderUserId_fkey" FOREIGN KEY ("paymentReminderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_paymentReminderTaskId_fkey" FOREIGN KEY ("paymentReminderTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Objednávky, které už v databázi jsou, se berou jako připomenuté —
-- jinak by první ranní plánovač po nasazení poslal připomínku ke všem
-- starým nezaplaceným objednávkám najednou (i týdny starým a zkušebním).
-- Připomínky tak chodí jen k objednávkám přijatým po nasazení.
UPDATE "orders" SET "paymentReminders" = 2 WHERE "status" <> 'ZAPLACENO';
