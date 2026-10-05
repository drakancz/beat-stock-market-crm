-- Kód z telefonu platí jednou (26. 9. 2026). Sloupec jen přibývá, nic se nemaže.
ALTER TABLE "two_factors" ADD COLUMN "lastUsedStep" INTEGER;
