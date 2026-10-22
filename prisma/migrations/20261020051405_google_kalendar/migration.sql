-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "googleCalendarActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleCalendarId" VARCHAR(200);
