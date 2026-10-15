-- CreateTable
CREATE TABLE "MonitorSummary" (
    "id" UUID NOT NULL,
    "slot" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "error" TEXT,

    CONSTRAINT "MonitorSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitorSummary_slot_key" ON "MonitorSummary"("slot");
