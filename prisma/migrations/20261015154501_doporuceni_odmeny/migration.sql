-- CreateEnum
CREATE TYPE "ReferrerKind" AS ENUM ('KLIENT', 'PARTNER');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "referredById" TEXT;

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN     "referrerId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "referrerId" TEXT;

-- CreateTable
CREATE TABLE "referrers" (
    "id" TEXT NOT NULL,
    "kind" "ReferrerKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "clientId" TEXT,
    "rewardPercent" DECIMAL(5,2) NOT NULL,
    "note" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "referrers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paidOutAt" TIMESTAMP(3),
    "paidOutById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referrers_clientId_key" ON "referrers"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_orderId_key" ON "referral_rewards"("orderId");

-- CreateIndex
CREATE INDEX "referral_rewards_referrerId_idx" ON "referral_rewards"("referrerId");

-- CreateIndex
CREATE INDEX "discount_codes_referrerId_idx" ON "discount_codes"("referrerId");

-- CreateIndex
CREATE INDEX "orders_referrerId_idx" ON "orders"("referrerId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "referrers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "referrers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "referrers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrers" ADD CONSTRAINT "referrers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_paidOutById_fkey" FOREIGN KEY ("paidOutById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
