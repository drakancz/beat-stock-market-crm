-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "brokerId" TEXT;

-- CreateIndex
CREATE INDEX "deals_brokerId_idx" ON "deals"("brokerId");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

