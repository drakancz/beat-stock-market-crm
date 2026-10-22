-- CreateTable
CREATE TABLE "lesson_ratings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "stars" SMALLINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_ratings_pkey" PRIMARY KEY ("id"),
    -- Hvězdičky jen 1–5 (Fáze 5C, 18. 10. 2026) — i kdyby kód někdy selhal.
    CONSTRAINT "lesson_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE INDEX "lesson_ratings_lessonId_idx" ON "lesson_ratings"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_ratings_clientId_lessonId_key" ON "lesson_ratings"("clientId", "lessonId");

-- AddForeignKey
ALTER TABLE "lesson_ratings" ADD CONSTRAINT "lesson_ratings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_ratings" ADD CONSTRAINT "lesson_ratings_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
