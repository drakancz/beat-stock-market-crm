-- Číslo objednávky RRRR-NNNN (Jakub, 24. 9. 2026).
--
-- Rok je podle času objednávky v Praze, pořadí běží v každém roce od 1.
-- Přiděluje ho spouštěč `orders_cislo` z počítadla `order_counters` —
-- zvýšení počítadla je jeden atomický příkaz, takže ani dvě souběžné
-- objednávky nedostanou stejné číslo. Číslo se po smazání znovu nepoužije.
--
-- `createdAt` drží Prisma jako čas bez pásma v UTC, proto dvojí převod.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "number" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "order_counters" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("year")
);

-- Stávající objednávky (i smazané) dostanou čísla podle toho, kdy přišly.
WITH roky AS (
  SELECT "id", "createdAt",
         EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Prague'))::int AS rok
  FROM "orders"
), poradi AS (
  SELECT "id", rok,
         ROW_NUMBER() OVER (PARTITION BY rok ORDER BY "createdAt", "id")::int AS n
  FROM roky
)
UPDATE "orders" o
SET "number" = p.rok::text || '-' || lpad(p.n::text, GREATEST(4, length(p.n::text)), '0')
FROM poradi p
WHERE o."id" = p."id";

INSERT INTO "order_counters" ("year", "last")
SELECT EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Prague'))::int, COUNT(*)
FROM "orders"
GROUP BY 1;

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- Přidělení čísla nové objednávce. Prázdný řetězec je výchozí hodnota
-- sloupce (Prisma ho potřebuje) a znamená „číslo ještě nemá".
CREATE FUNCTION "orders_cislo"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rok int;
  poradi int;
BEGIN
  IF NEW."number" IS NOT NULL AND NEW."number" <> '' THEN
    RETURN NEW;
  END IF;

  rok := EXTRACT(YEAR FROM (COALESCE(NEW."createdAt", now() AT TIME ZONE 'UTC')
                            AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Prague'))::int;

  INSERT INTO "order_counters" ("year", "last") VALUES (rok, 1)
  ON CONFLICT ("year") DO UPDATE SET "last" = "order_counters"."last" + 1
  RETURNING "last" INTO poradi;

  NEW."number" := rok::text || '-' || lpad(poradi::text, GREATEST(4, length(poradi::text)), '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_cislo"
BEFORE INSERT ON "orders"
FOR EACH ROW EXECUTE FUNCTION "orders_cislo"();
