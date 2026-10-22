-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "inactiveMemberDays" INTEGER NOT NULL DEFAULT 21;

-- Stávající účty: poslední návštěva = poslední přihlášení (přesnější údaj
-- do té doby nebyl). Bez toho by všichni dnešní členové vypadali, že nechodí.
UPDATE "client_accounts" SET "lastSeenAt" = "lastLoginAt" WHERE "lastSeenAt" IS NULL;
