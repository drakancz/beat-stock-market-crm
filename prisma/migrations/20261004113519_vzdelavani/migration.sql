-- CreateEnum
CREATE TYPE "WebinarAudience" AS ENUM ('VSICHNI', 'CLENOVE', 'KURZ');

-- CreateEnum
CREATE TYPE "BadgeKind" AS ENUM ('PRVNI_LEKCE', 'PULKA_KURZU', 'KURZ_DOKONCEN', 'AKTIVNI_4_TYDNY', 'PRVNI_WEBINAR', 'PET_WEBINARU');

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_lessons" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "videoUrl" VARCHAR(500),
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_posts" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "videoUrl" VARCHAR(500),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "member_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinars" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "joinUrl" VARCHAR(500),
    "audience" "WebinarAudience" NOT NULL,
    "courseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webinars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_attendance" (
    "id" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webinar_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_badges" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "BadgeKind" NOT NULL,
    "refId" VARCHAR(64) NOT NULL DEFAULT '',
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_active_weeks" (
    "clientId" TEXT NOT NULL,
    "week" VARCHAR(8) NOT NULL,

    CONSTRAINT "client_active_weeks_pkey" PRIMARY KEY ("clientId","week")
);

-- CreateIndex
CREATE INDEX "courses_productId_idx" ON "courses"("productId");

-- CreateIndex
CREATE INDEX "course_lessons_courseId_position_idx" ON "course_lessons"("courseId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_clientId_lessonId_key" ON "lesson_progress"("clientId", "lessonId");

-- CreateIndex
CREATE INDEX "member_posts_publishedAt_idx" ON "member_posts"("publishedAt");

-- CreateIndex
CREATE INDEX "webinars_startsAt_idx" ON "webinars"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_attendance_webinarId_clientId_key" ON "webinar_attendance"("webinarId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_badges_clientId_kind_refId_key" ON "client_badges"("clientId", "kind", "refId");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinars" ADD CONSTRAINT "webinars_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_attendance" ADD CONSTRAINT "webinar_attendance_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "webinars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_attendance" ADD CONSTRAINT "webinar_attendance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_attendance" ADD CONSTRAINT "webinar_attendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_badges" ADD CONSTRAINT "client_badges_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_active_weeks" ADD CONSTRAINT "client_active_weeks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
