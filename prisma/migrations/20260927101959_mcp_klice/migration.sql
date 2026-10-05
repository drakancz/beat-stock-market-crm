-- AlterEnum
ALTER TYPE "UserEventKind" ADD VALUE 'MCP';

-- CreateTable
CREATE TABLE "mcp_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "mcp_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_keys_keyHash_key" ON "mcp_keys"("keyHash");

-- CreateIndex
CREATE INDEX "mcp_keys_userId_idx" ON "mcp_keys"("userId");

-- AddForeignKey
ALTER TABLE "mcp_keys" ADD CONSTRAINT "mcp_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
