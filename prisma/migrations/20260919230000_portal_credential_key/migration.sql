-- AlterTable: add unique logical key for PortalCredential
ALTER TABLE "PortalCredential" ADD COLUMN "key" TEXT;

-- Backfill any existing rows with a stable placeholder key before NOT NULL
UPDATE "PortalCredential"
SET "key" = 'legacy-' || REPLACE("id"::text, '-', '')
WHERE "key" IS NULL;

ALTER TABLE "PortalCredential" ALTER COLUMN "key" SET NOT NULL;

CREATE UNIQUE INDEX "PortalCredential_key_key" ON "PortalCredential"("key");

-- Application.portalCredentialId is retained (deprecated) for historical data.
-- Token broker resolution is now portalHostKey → PortalCredential.key.
