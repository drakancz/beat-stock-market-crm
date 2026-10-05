-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "product_validities" ADD COLUMN     "notifiedDayForUntil" TIMESTAMP(3),
ADD COLUMN     "notifiedWeekForUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "client_push_subscriptions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "endpoint" VARCHAR(2048) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "device" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "client_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_messages" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" VARCHAR(1000) NOT NULL,
    "delivery" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "client_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_push_subscriptions_endpoint_key" ON "client_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "client_push_subscriptions_accountId_idx" ON "client_push_subscriptions"("accountId");

-- CreateIndex
CREATE INDEX "client_messages_clientId_createdAt_idx" ON "client_messages"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "client_push_subscriptions" ADD CONSTRAINT "client_push_subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "client_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
