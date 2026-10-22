-- Hovory a souhlas s nahráváním z CRM zmizely (Jakub, 20. 10. 2026).
-- MAŽE DATA: tabulku hovorů i datum souhlasu s nahráváním. Na serveru
-- podle MCP žádný hovor nebyl (bez smazaných); před nasazením záloha
-- a kontrola v zkušební databázi (docs/funkce/nasazeni-railway.md).

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_clientId_fkey";

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_interestProductId_fkey";

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_orderId_fkey";

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_userId_fkey";

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "consentRecordingAt";

-- DropTable
DROP TABLE "calls";

-- DropEnum
DROP TYPE "CallOutcome";
