-- Příjem leadů z webu přes `POST /api/leady` (Jakub, 12. 9. 2026).
--
-- Tři věci dohromady:
--  1. u klienta stačí jeden kontakt (e-mail NEBO telefon), ne oba,
--  2. klient má poznámku, do které se zapíše broker, kterého neznáme,
--  3. v nastavení firmy je vybraný příjemce a zdroj leadů.
--
-- Doplněno ručně proti vygenerované podobě: kontrola kontaktu, převod
-- prázdných textů na prázdnou hodnotu a předvyplnění nastavení. Bez
-- předvyplnění by endpoint po nasazení nepřijal nic — klient bez
-- obchodníka totiž nesmí vzniknout.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "note" TEXT,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "leadOwnerId" TEXT,
ADD COLUMN     "leadSourceId" TEXT;

-- CreateIndex
CREATE INDEX "clients_phone_idx" ON "clients"("phone");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_leadOwnerId_fkey" FOREIGN KEY ("leadOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "client_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prázdný text není kontakt. Kdyby někde zůstal, kontrola níže by ho
-- uznala jako vyplněný údaj a v seznamu by byl klient, na kterého se
-- nedá nijak dovolat.
UPDATE "clients" SET "email" = NULL WHERE btrim("email") = '';
UPDATE "clients" SET "phone" = NULL WHERE btrim("phone") = '';

-- Aspoň jeden kontakt. Hlídá to databáze, ne jen formulář — přes API
-- i seedy se do tabulky dá zapsat i mimo aplikaci.
ALTER TABLE "clients" ADD CONSTRAINT "clients_kontakt_check"
    CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Zdroj pro klienty z webu. Na databázi, kde vznikl při převodu zdrojů
-- z volného textu, se použije ten stávající — ať nejsou dva stejné.
INSERT INTO "client_sources" ("id", "name", "order", "updatedAt")
SELECT 'zdroj-web', 'Web', COALESCE((SELECT MAX("order") FROM "client_sources"), 0) + 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "client_sources" WHERE lower("name") = 'web');

UPDATE "company_settings"
SET "leadSourceId" = COALESCE(
    (SELECT "id" FROM "client_sources" WHERE lower("name") = 'web' ORDER BY "createdAt" LIMIT 1),
    (SELECT "id" FROM "client_sources" ORDER BY "order" LIMIT 1)
)
WHERE "leadSourceId" IS NULL;

-- Nejstarší administrátor jako výchozí příjemce. Kdo to má být doopravdy,
-- si administrátor přepne v Nastavení → Příjem leadů.
UPDATE "company_settings"
SET "leadOwnerId" = (
    SELECT "id" FROM "users"
    WHERE "role" = 'ADMINISTRATOR' AND "deletedAt" IS NULL AND "active" = true
    ORDER BY "createdAt"
    LIMIT 1
)
WHERE "leadOwnerId" IS NULL;
