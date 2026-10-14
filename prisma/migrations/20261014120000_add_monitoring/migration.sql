-- CreateEnum
CREATE TYPE "MonitorOutcome" AS ENUM ('PASS', 'WARN', 'FAIL', 'SKIP');

-- CreateTable
CREATE TABLE "MonitorRun" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MonitorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCheckResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "checkType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "outcome" "MonitorOutcome" NOT NULL,
    "latencyMs" INTEGER,
    "detail" TEXT,
    "meta" JSONB,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "failingSince" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitorRun_startedAt_idx" ON "MonitorRun"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "MonitorCheckResult_checkType_targetKey_checkedAt_idx" ON "MonitorCheckResult"("checkType", "targetKey", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "MonitorCheckResult_checkedAt_idx" ON "MonitorCheckResult"("checkedAt");

-- CreateIndex
CREATE INDEX "MonitorCheckResult_runId_idx" ON "MonitorCheckResult"("runId");

-- AddForeignKey
ALTER TABLE "MonitorCheckResult" ADD CONSTRAINT "MonitorCheckResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitorRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

