-- AlterEnum
ALTER TYPE "CallOutcome" ADD VALUE 'AUTOMATICKY';

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "dealId" TEXT;

-- CreateIndex
CREATE INDEX "calls_dealId_idx" ON "calls"("dealId");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
