-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "errorNotificationSentAt" TIMESTAMP(3),
ADD COLUMN     "errorNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
