-- CreateTable
CREATE TABLE "lesson_questions" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answer" VARCHAR(4000),
    "answeredAt" TIMESTAMP(3),
    "answeredById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByClient" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lesson_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_questions_answeredAt_createdAt_idx" ON "lesson_questions"("answeredAt", "createdAt");

-- CreateIndex
CREATE INDEX "lesson_questions_clientId_lessonId_idx" ON "lesson_questions"("clientId", "lessonId");

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
