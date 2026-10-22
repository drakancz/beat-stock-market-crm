-- Kvízy u lekcí a certifikáty o absolvování kurzu (Fáze 5C, Jakub 11. 10. 2026).
-- Jen přidává tabulky, nic nemění ani nemaže.

-- CreateTable
CREATE TABLE "lesson_quizzes" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lesson_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "correct" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_certificates" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "clientName" VARCHAR(200) NOT NULL,
    "courseTitle" VARCHAR(200) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_counters" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "certificate_counters_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_quizzes_lessonId_key" ON "lesson_quizzes"("lessonId");

-- CreateIndex
CREATE INDEX "quiz_attempts_clientId_quizId_idx" ON "quiz_attempts"("clientId", "quizId");

-- CreateIndex
CREATE UNIQUE INDEX "course_certificates_number_key" ON "course_certificates"("number");

-- CreateIndex
CREATE UNIQUE INDEX "course_certificates_clientId_courseId_key" ON "course_certificates"("clientId", "courseId");

-- AddForeignKey
ALTER TABLE "lesson_quizzes" ADD CONSTRAINT "lesson_quizzes_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "lesson_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Číslo certifikátu CERT-RRRR-NNNN — stejný princip jako číslo objednávky
-- (`orders_cislo`): rok podle data vydání v Praze, pořadí v každém roce
-- od 1, zvýšení počítadla je jeden atomický příkaz. Prázdný řetězec je
-- výchozí hodnota sloupce (Prisma ho potřebuje) a znamená „číslo ještě nemá".
CREATE FUNCTION "course_certificates_cislo"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rok int;
  poradi int;
BEGIN
  IF NEW."number" IS NOT NULL AND NEW."number" <> '' THEN
    RETURN NEW;
  END IF;

  rok := EXTRACT(YEAR FROM (COALESCE(NEW."issuedAt", now() AT TIME ZONE 'UTC')
                            AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Prague'))::int;

  INSERT INTO "certificate_counters" ("year", "last") VALUES (rok, 1)
  ON CONFLICT ("year") DO UPDATE SET "last" = "certificate_counters"."last" + 1
  RETURNING "last" INTO poradi;

  NEW."number" := 'CERT-' || rok::text || '-' || lpad(poradi::text, GREATEST(4, length(poradi::text)), '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "course_certificates_cislo"
BEFORE INSERT ON "course_certificates"
FOR EACH ROW EXECUTE FUNCTION "course_certificates_cislo"();
