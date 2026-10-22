-- CreateTable
CREATE TABLE "automation_tag_pairs" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_tag_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_tag_pairs_productId_tagId_key" ON "automation_tag_pairs"("productId", "tagId");

-- AddForeignKey
ALTER TABLE "automation_tag_pairs" ADD CONSTRAINT "automation_tag_pairs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tag_pairs" ADD CONSTRAINT "automation_tag_pairs_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "client_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dosavadní jedna dvojice pravidla Zaplaceno → štítek se převede jako první
-- řádek seznamu (18. 10. 2026). Sloupce v automation_rules se už nečtou.
INSERT INTO "automation_tag_pairs" ("id", "productId", "tagId")
SELECT gen_random_uuid()::text, "productId", "tagId"
  FROM "automation_rules"
 WHERE "id" = 'zaplaceno-stitek' AND "productId" IS NOT NULL AND "tagId" IS NOT NULL;
