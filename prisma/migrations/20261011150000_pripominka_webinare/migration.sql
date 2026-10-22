-- Připomínka webináře (Fáze 5C, Jakub 11. 10. 2026). Jen přidává sloupce.
--
-- Webináře, které už proběhly nebo začínají do dneška, se berou jako
-- připomenuté, ať první běh plánovače nic nedohání zpětně.

-- AlterTable
ALTER TABLE "webinars" ADD COLUMN     "remindedDayAt" TIMESTAMP(3),
ADD COLUMN     "remindedDayCount" INTEGER,
ADD COLUMN     "remindedHourAt" TIMESTAMP(3),
ADD COLUMN     "remindedHourCount" INTEGER,
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;


UPDATE "webinars" SET "remindedDayAt" = now(), "remindedHourAt" = now()
  WHERE "startsAt" < now() + interval '1 day';
