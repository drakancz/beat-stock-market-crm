-- CreateTable
CREATE TABLE "client_accounts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordSetAt" TIMESTAMP(3),
    "tokensValidFrom" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "invitedAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_password_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_password_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_two_factors" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT[],
    "confirmedAt" TIMESTAMP(3),
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_clientId_key" ON "client_accounts"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_password_tokens_tokenHash_key" ON "client_password_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "client_password_tokens_accountId_idx" ON "client_password_tokens"("accountId");

-- CreateIndex
CREATE INDEX "client_password_tokens_expiresAt_idx" ON "client_password_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_two_factors_accountId_key" ON "client_two_factors"("accountId");

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_password_tokens" ADD CONSTRAINT "client_password_tokens_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "client_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_two_factors" ADD CONSTRAINT "client_two_factors_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "client_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
