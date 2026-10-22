-- Štítky u klientů a uložené filtry (Fáze 5B, Jakub 11. 10. 2026). Jen přidává.

-- CreateEnum
CREATE TYPE "TagColor" AS ENUM ('ZAKLADNI', 'ZNACKA', 'ZELENA', 'JANTAR', 'CERVENA');

-- CreateTable
CREATE TABLE "client_tags" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'ZAKLADNI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_tag_links" (
    "clientId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_tag_links_pkey" PRIMARY KEY ("clientId","tagId")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "query" VARCHAR(500) NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_tag_links_tagId_idx" ON "client_tag_links"("tagId");

-- CreateIndex
CREATE INDEX "saved_filters_userId_idx" ON "saved_filters"("userId");

-- AddForeignKey
ALTER TABLE "client_tag_links" ADD CONSTRAINT "client_tag_links_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tag_links" ADD CONSTRAINT "client_tag_links_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "client_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tag_links" ADD CONSTRAINT "client_tag_links_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

