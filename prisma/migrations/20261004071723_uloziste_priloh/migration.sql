-- CreateEnum
CREATE TYPE "AttachmentStorage" AS ENUM ('UPLOADTHING', 'S3');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "storage" "AttachmentStorage" NOT NULL DEFAULT 'UPLOADTHING';
