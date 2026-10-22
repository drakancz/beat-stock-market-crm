-- CreateTable
CREATE TABLE "consultation_slots" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "place" VARCHAR(200),
    "joinUrl" VARCHAR(500),
    "hostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activeBookingId" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "consultation_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_bookings" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByClient" BOOLEAN NOT NULL DEFAULT false,
    "cancelledById" TEXT,
    "taskId" TEXT,
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "consultation_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultation_slots_activeBookingId_key" ON "consultation_slots"("activeBookingId");

-- CreateIndex
CREATE INDEX "consultation_slots_startsAt_idx" ON "consultation_slots"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_bookings_taskId_key" ON "consultation_bookings"("taskId");

-- CreateIndex
CREATE INDEX "consultation_bookings_clientId_idx" ON "consultation_bookings"("clientId");

-- CreateIndex
CREATE INDEX "consultation_bookings_slotId_idx" ON "consultation_bookings"("slotId");

-- AddForeignKey
ALTER TABLE "consultation_slots" ADD CONSTRAINT "consultation_slots_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_slots" ADD CONSTRAINT "consultation_slots_activeBookingId_fkey" FOREIGN KEY ("activeBookingId") REFERENCES "consultation_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "consultation_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
