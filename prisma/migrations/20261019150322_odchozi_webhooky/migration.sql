-- CreateTable
CREATE TABLE "outgoing_webhooks" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastAttemptAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "lastError" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "outgoing_webhooks_pkey" PRIMARY KEY ("id")
);
