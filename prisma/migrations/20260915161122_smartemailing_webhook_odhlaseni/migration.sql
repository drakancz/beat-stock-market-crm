-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "smartemailingOptedOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "smartemailingWebhookId" INTEGER;
