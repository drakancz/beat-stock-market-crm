-- Profil uživatele: jméno, příjmení, telefon a oslovení (Jakub, 10. 9. 2026).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "vocative" TEXT;

-- Dosavadní celé jméno se rozdělí: první slovo je jméno, zbytek příjmení.
-- Oslovení zůstává prázdné — navrhne se z křestního jména.
UPDATE "users"
SET "firstName" = split_part(trim("name"), ' ', 1),
    "lastName" = trim(substr(trim("name"), length(split_part(trim("name"), ' ', 1)) + 1));
