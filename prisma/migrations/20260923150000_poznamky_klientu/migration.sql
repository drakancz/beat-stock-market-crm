-- Poznámky u klienta jako jednotlivé zápisy (Jakub, 23. 9. 2026).
--
-- Do té doby měl klient jednu společnou poznámku (`clients.note`), do
-- které psal tým i příjem z webu. Nově má každý zápis autora a čas —
-- okno Poznámky na kartě klienta.
--
-- **Stará poznámka se převádí, nemaže**: stane se prvním zápisem bez
-- autora (psal ji dílem systém, dílem lidé a rozlišit to nejde). Čas je
-- poslední úprava klienta — přesnější odhad v databázi není.

-- 1. Tabulka.
CREATE TABLE "client_notes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_notes_clientId_createdAt_idx" ON "client_notes"("clientId", "createdAt");

ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Převod staré poznámky. Id je odvozené z id klienta — klient měl
--    nejvýš jednu poznámku, takže je jedinečné.
INSERT INTO "client_notes" ("id", "clientId", "authorId", "text", "createdAt", "updatedAt")
SELECT 'prevod-' || "id", "id", NULL, btrim("note"), "updatedAt", "updatedAt"
FROM "clients"
WHERE "note" IS NOT NULL AND btrim("note") <> '';

-- 3. Stará poznámka zaniká.
ALTER TABLE "clients" DROP COLUMN "note";
