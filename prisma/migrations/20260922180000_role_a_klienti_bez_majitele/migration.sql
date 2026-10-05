-- Klient nepatří nikomu a role se slučují na dvě (Jakub, 22. 9. 2026).
--
-- Objednávky chodí z Landing Page, takže dělit klienty mezi obchodníky
-- nemá co řídit. Všechny záznamy proto vidí každý přihlášený a role
-- rozhoduje už jen o tom, kdo spravuje systém.
--
-- **Data se převádějí, ne mažou** — na rozdíl od objednávek tu jde
-- o skutečné účty a klienty.

-- 1. Role: OBCHODNIK i MANAZER se stávají UZIVATEL.
--
-- Enum se v PostgreSQL nedá přejmenovat po hodnotách, takže vzniká nový
-- typ a sloupec se do něj převede. Bez `DROP DEFAULT` by převod spadl na
-- tom, že výchozí hodnota `OBCHODNIK` v novém typu neexistuje.
CREATE TYPE "Role_new" AS ENUM ('UZIVATEL', 'ADMINISTRATOR');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE WHEN "role" = 'ADMINISTRATOR' THEN 'ADMINISTRATOR' ELSE 'UZIVATEL' END)::text::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'UZIVATEL';

-- 2. Klient přestává mít přiřazeného obchodníka.
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_ownerId_fkey";
DROP INDEX IF EXISTS "clients_ownerId_idx";
ALTER TABLE "clients" DROP COLUMN "ownerId";

-- 3. Cíle jsou nově za celou firmu. Řádky pro jednotlivce by se už nikde
--    nezobrazily a `nactiPlneniCilu()` čte jen ten s prázdným `userId`.
DELETE FROM "sales_targets" WHERE "userId" IS NOT NULL;

-- 4. Nastavení → Příjem leadů zaniklo: přiřazovat není komu a zdroj je
--    vždycky Landing Page.
ALTER TABLE "company_settings" DROP CONSTRAINT IF EXISTS "company_settings_leadOwnerId_fkey";
ALTER TABLE "company_settings" DROP CONSTRAINT IF EXISTS "company_settings_leadSourceId_fkey";
ALTER TABLE "company_settings" DROP COLUMN "leadOwnerId";
ALTER TABLE "company_settings" DROP COLUMN "leadSourceId";

-- 5. Zdroj „Landing Page" — klienti z webu ho dostanou vždycky.
--    Zakládá se s pevným id, aby ho kód našel bez hledání podle názvu.
INSERT INTO "client_sources" ("id", "name", "order", "active", "createdAt", "updatedAt")
VALUES ('landing-page', 'Landing Page', 0, true, now(), now())
ON CONFLICT ("id") DO NOTHING;
