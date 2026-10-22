-- CreateEnum
CREATE TYPE "ClientFieldKind" AS ENUM ('TEXT', 'CISLO', 'DATUM', 'ANO_NE', 'VYBER');

-- CreateTable
CREATE TABLE "client_fields" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" "ClientFieldKind" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_field_values" (
    "clientId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "client_field_values_pkey" PRIMARY KEY ("clientId","fieldId")
);

-- CreateIndex
CREATE INDEX "client_fields_position_idx" ON "client_fields"("position");

-- CreateIndex
CREATE INDEX "client_field_values_fieldId_value_idx" ON "client_field_values"("fieldId", "value");

-- AddForeignKey
ALTER TABLE "client_field_values" ADD CONSTRAINT "client_field_values_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_field_values" ADD CONSTRAINT "client_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "client_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_field_values" ADD CONSTRAINT "client_field_values_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
