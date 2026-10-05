-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "mergedIntoId" TEXT;

-- CreateTable
CREATE TABLE "client_not_duplicates" (
    "id" TEXT NOT NULL,
    "clientAId" TEXT NOT NULL,
    "clientBId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_not_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_not_duplicates_clientBId_idx" ON "client_not_duplicates"("clientBId");

-- CreateIndex
CREATE UNIQUE INDEX "client_not_duplicates_clientAId_clientBId_key" ON "client_not_duplicates"("clientAId", "clientBId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_not_duplicates" ADD CONSTRAINT "client_not_duplicates_clientAId_fkey" FOREIGN KEY ("clientAId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_not_duplicates" ADD CONSTRAINT "client_not_duplicates_clientBId_fkey" FOREIGN KEY ("clientBId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_not_duplicates" ADD CONSTRAINT "client_not_duplicates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
