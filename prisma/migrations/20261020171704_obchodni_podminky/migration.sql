-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" VARCHAR(20);
