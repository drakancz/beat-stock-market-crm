-- AlterTable
ALTER TABLE "course_lessons" ADD COLUMN     "unlockAfterDays" SMALLINT,
ADD COLUMN     "unlockAfterPrevious" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unlockOn" TIMESTAMP(3);

-- Počet dní 0–365 (Fáze 5C, 18. 10. 2026) — i kdyby kód někdy selhal.
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_unlock_days_check"
  CHECK ("unlockAfterDays" IS NULL OR "unlockAfterDays" BETWEEN 0 AND 365);
