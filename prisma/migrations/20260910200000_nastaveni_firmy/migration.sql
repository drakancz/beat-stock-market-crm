-- Nastavení firmy: zdroje klientů, údaje firmy, zabezpečení, cíle,
-- e-maily a pracovní dny (Jakub, 10. 9. 2026).
--
-- Psáno ručně: zdroj klienta byl volný text a převádí se do seznamu —
-- Prisma by sloupec zahodila i s obsahem.

-- CreateTable
CREATE TABLE "client_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_sources_pkey" PRIMARY KEY ("id")
);

-- Každý dosavadní text se stane položkou seznamu. Stejné texty se
-- sejdou v jedné položce; podobné (FB × Facebook) sloučí administrátor.
INSERT INTO "client_sources" ("id", "name", "order", "updatedAt")
SELECT 'zdroj-' || md5(t."nazev"), t."nazev", (row_number() OVER (ORDER BY t."nazev"))::int, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT trim("source") AS "nazev" FROM "clients") AS t;

-- Na čisté databázi bez klientů by seznam zůstal prázdný a klienta by
-- nešlo založit — dostane proto základní nabídku.
INSERT INTO "client_sources" ("id", "name", "order", "updatedAt")
SELECT v."id", v."name", v."order", CURRENT_TIMESTAMP
FROM (VALUES
    ('zdroj-facebook', 'Facebook', 1),
    ('zdroj-instagram', 'Instagram', 2),
    ('zdroj-webinar', 'Webinář', 3),
    ('zdroj-doporuceni', 'Doporučení', 4),
    ('zdroj-web', 'Web', 5),
    ('zdroj-jiny', 'Jiný', 6)
) AS v("id", "name", "order")
WHERE NOT EXISTS (SELECT 1 FROM "client_sources");

ALTER TABLE "clients" ADD COLUMN "sourceId" TEXT;
UPDATE "clients" SET "sourceId" = 'zdroj-' || md5(trim("source"));
ALTER TABLE "clients" ALTER COLUMN "sourceId" SET NOT NULL;
ALTER TABLE "clients" DROP COLUMN "source";

-- CreateIndex
CREATE INDEX "clients_sourceId_idx" ON "clients"("sourceId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "client_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "TwoFactorPolicy" AS ENUM ('NIKDO', 'ADMINISTRATORI', 'VSICHNI');

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL DEFAULT 'firma',
    "companyName" TEXT NOT NULL DEFAULT 'Beat Stock Market',
    "ico" TEXT,
    "dic" TEXT,
    "address" TEXT,
    "vatPayer" BOOLEAN NOT NULL DEFAULT true,
    "emailSenderName" TEXT,
    "emailSignature" TEXT,
    "twoFactorPolicy" "TwoFactorPolicy" NOT NULL DEFAULT 'NIKDO',
    "sessionHours" INTEGER NOT NULL DEFAULT 12,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "company_settings" ("id", "updatedAt") VALUES ('firma', CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "userId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_targets_userId_month_idx" ON "sales_targets"("userId", "month");

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "company_days_off" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "company_days_off_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_days_off_date_idx" ON "company_days_off"("date");
