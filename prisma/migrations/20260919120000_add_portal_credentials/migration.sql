-- AlterEnum
ALTER TYPE "ApplicationAuditAction" ADD VALUE 'PORTAL_CREDENTIAL_CREATED';
ALTER TYPE "ApplicationAuditAction" ADD VALUE 'PORTAL_CREDENTIAL_UPDATED';
ALTER TYPE "ApplicationAuditAction" ADD VALUE 'PORTAL_CREDENTIAL_PASSWORD_ROTATED';
ALTER TYPE "ApplicationAuditAction" ADD VALUE 'PORTAL_CREDENTIAL_ACTIVATED';
ALTER TYPE "ApplicationAuditAction" ADD VALUE 'PORTAL_CREDENTIAL_DEACTIVATED';
ALTER TYPE "ApplicationAuditAction" ADD VALUE 'APPLICATION_PORTAL_CREDENTIAL_ASSIGNED';

-- CreateTable
CREATE TABLE "PortalCredential" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "portalUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalCredential_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "portalCredentialId" UUID;

-- CreateIndex
CREATE INDEX "PortalCredential_isActive_idx" ON "PortalCredential"("isActive");

-- CreateIndex
CREATE INDEX "Application_portalCredentialId_idx" ON "Application"("portalCredentialId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_portalCredentialId_fkey" FOREIGN KEY ("portalCredentialId") REFERENCES "PortalCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
