-- CreateEnum
CREATE TYPE "ApplicationAuditAction" AS ENUM (
    'APPLICATION_CREATED',
    'APPLICATION_METADATA_UPDATED',
    'APPLICATION_ACTIVATED',
    'APPLICATION_DEACTIVATED',
    'APPLICATION_CONFIG_REPLACED'
);

-- CreateTable
CREATE TABLE "ApplicationAuditLog" (
    "id" UUID NOT NULL,
    "applicationId" UUID,
    "applicationKey" TEXT NOT NULL,
    "actorId" UUID,
    "actorEmail" TEXT NOT NULL,
    "action" "ApplicationAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationAuditLog_createdAt_id_idx" ON "ApplicationAuditLog"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ApplicationAuditLog_applicationKey_createdAt_idx" ON "ApplicationAuditLog"("applicationKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApplicationAuditLog_actorEmail_createdAt_idx" ON "ApplicationAuditLog"("actorEmail", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApplicationAuditLog_action_createdAt_idx" ON "ApplicationAuditLog"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ApplicationAuditLog" ADD CONSTRAINT "ApplicationAuditLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAuditLog" ADD CONSTRAINT "ApplicationAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
