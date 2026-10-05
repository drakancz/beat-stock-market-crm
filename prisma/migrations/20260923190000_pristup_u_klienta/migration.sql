-- Přístup do programu je jeden za klienta (Jakub, 23. 9. 2026).
--
-- Do té doby byl u každé objednávky zvlášť. **Data se převádějí, ne
-- mažou:** klient dostane „Povolen", když ho měl povolený aspoň u jedné
-- objednávky (i smazané — přístup mu tehdy někdo vědomě zařídil).

-- 1. Sloupec u klienta.
ALTER TABLE "clients" ADD COLUMN "programAccess" "ProgramAccess" NOT NULL DEFAULT 'NEPOVOLEN';

-- 2. Převod z objednávek.
UPDATE "clients" c
SET "programAccess" = 'POVOLEN'
WHERE EXISTS (
  SELECT 1 FROM "orders" o
  WHERE o."clientId" = c."id" AND o."programAccess" = 'POVOLEN'
);

-- 3. U objednávky přístup zaniká.
ALTER TABLE "orders" DROP COLUMN "programAccess";
