-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('FAKTURA', 'DOBROPIS');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "billingCity" VARCHAR(100),
ADD COLUMN     "billingCountry" CHAR(2),
ADD COLUMN     "billingDic" VARCHAR(20),
ADD COLUMN     "billingIco" VARCHAR(20),
ADD COLUMN     "billingName" VARCHAR(200),
ADD COLUMN     "billingStreet" VARCHAR(200),
ADD COLUMN     "billingZip" VARCHAR(20);

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "bankAccount" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "kind" "InvoiceKind" NOT NULL,
    "orderId" TEXT NOT NULL,
    "correctsId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxableAt" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "baseTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "simplified" BOOLEAN NOT NULL DEFAULT false,
    "supplier" JSONB NOT NULL,
    "customer" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "prefix" VARCHAR(4) NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_issuedAt_idx" ON "invoices"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_orderId_kind_key" ON "invoices"("orderId", "kind");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Číslo dokladu FV-RRRR-NNNN (faktura) / DB-RRRR-NNNN (dobropis), 19. 10. 2026.
-- Rok podle data vystavení v Praze, pořadí v každé řadě a roce od 1.
-- Přiděluje databáze — zvýšení počítadla je jeden atomický příkaz, takže
-- dva souběžné doklady nedostanou stejné číslo. Číselná řada nesmí mít
-- díry kvůli smazání — doklady se nemažou.
CREATE FUNCTION "invoices_cislo"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rada text;
  rok int;
  poradi int;
BEGIN
  IF NEW."number" IS NOT NULL AND NEW."number" <> '' THEN
    RETURN NEW;
  END IF;

  rada := CASE WHEN NEW."kind" = 'DOBROPIS' THEN 'DB' ELSE 'FV' END;
  rok := EXTRACT(YEAR FROM (COALESCE(NEW."issuedAt", now() AT TIME ZONE 'UTC')
                            AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Prague'))::int;

  INSERT INTO "invoice_counters" ("prefix", "year", "last") VALUES (rada, rok, 1)
  ON CONFLICT ("prefix", "year") DO UPDATE SET "last" = "invoice_counters"."last" + 1
  RETURNING "last" INTO poradi;

  NEW."number" := rada || '-' || rok::text || '-' || lpad(poradi::text, GREATEST(4, length(poradi::text)), '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_cislo"
BEFORE INSERT ON "invoices"
FOR EACH ROW EXECUTE FUNCTION "invoices_cislo"();
