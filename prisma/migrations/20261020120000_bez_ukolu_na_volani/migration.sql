-- Úkoly na volání z CRM zmizely (Jakub, 20. 10. 2026): úkol na prodloužení,
-- úkol zavolat s druhou připomínkou platby a pravidlo Nechodí → úkol
-- „Ozvat se“. Otevřené úkoly těchto druhů se odloží do koše (deletedAt),
-- jako když úkol smaže člověk; řádky v tabulce úkolů zůstávají.

UPDATE "tasks" SET "deletedAt" = now(), "updatedAt" = now()
 WHERE "deletedAt" IS NULL
   AND "doneAt" IS NULL
   AND (
     "id" IN (SELECT "reminderTaskId" FROM "product_validities" WHERE "reminderTaskId" IS NOT NULL)
     OR "id" IN (SELECT "paymentReminderTaskId" FROM "orders" WHERE "paymentReminderTaskId" IS NOT NULL)
     OR "id" IN (SELECT "entityId" FROM "audit_log"
                  WHERE "entity" = 'tasks' AND "action" = 'ukol.zalozen'
                    AND "after"->>'pravidlo' = 'nechodi-ukol')
   );

-- Pravidlo Nechodí → úkol: nastavení i záznamy „už provedeno“ (cascade).
DELETE FROM "automation_rules" WHERE "id" = 'nechodi-ukol';

-- DropForeignKey
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rules_userId_fkey";

-- DropForeignKey
ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_paymentReminderUserId_fkey";

-- DropForeignKey
ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_renewalUserId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_paymentReminderTaskId_fkey";

-- DropForeignKey
ALTER TABLE "product_validities" DROP CONSTRAINT "product_validities_reminderTaskId_fkey";

-- DropIndex
DROP INDEX "orders_paymentReminderTaskId_key";

-- DropIndex
DROP INDEX "product_validities_reminderTaskId_key";

-- AlterTable
ALTER TABLE "automation_rules" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "company_settings" DROP COLUMN "paymentReminderUserId",
DROP COLUMN "renewalLeadDays",
DROP COLUMN "renewalUserId";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "paymentReminderTaskId";

-- AlterTable
ALTER TABLE "product_validities" DROP COLUMN "reminderForUntil",
DROP COLUMN "reminderTaskId";
