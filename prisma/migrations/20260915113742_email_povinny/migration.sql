-- E-mail u klienta je povinný, telefon ne (Jakub, 15. 9. 2026).
--
-- Od 12. 9. do té doby stačil jeden kontakt (e-mail NEBO telefon).
-- Klienta bez e-mailu ale nejde poslat do SmartEmailingu ani mu napsat.
--
-- Doplněno ručně proti vygenerované podobě: kontrola, že žádný klient
-- bez e-mailu nezůstal, a zrušení kontroly „aspoň jeden kontakt" —
-- Prisma o ní neví, vznikla ručně v migraci 20260912190506_prijem_leadu.
--
-- Klienty bez e-mailu migrace sama nemaže ani jim nic nevymýšlí: ve
-- vývojové databázi je Jakub nechal nadobro smazat přes Smazané. Kdyby
-- takový klient někde zůstal, migrace skončí srozumitelnou chybou.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "clients" WHERE "email" IS NULL OR btrim("email") = '') THEN
        RAISE EXCEPTION 'V tabulce clients jsou klienti bez e-mailu. Doplň jim e-mail, nebo je smaž, a migraci spusť znovu.';
    END IF;
END $$;

-- Pravidlo „aspoň jeden kontakt" nahrazuje povinný e-mail.
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_kontakt_check";

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "email" SET NOT NULL;
