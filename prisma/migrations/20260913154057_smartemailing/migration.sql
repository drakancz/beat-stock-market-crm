-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "smartemailingError" VARCHAR(32),
ADD COLUMN     "smartemailingSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "smartemailingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smartemailingListId" INTEGER,
ADD COLUMN     "smartemailingListName" TEXT;
