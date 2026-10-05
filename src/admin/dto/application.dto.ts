import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { RuntimeConfigDocumentDto } from '../../config/dto/runtime-config.dto';
import { PortalCredentialSummaryDto } from '../../portal/dto/portal-credential.dto';

export class ApplicationListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'education-mapping' })
  key!: string;

  @ApiProperty({ example: 'Education Mapping' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'uuid',
    deprecated: true,
    description:
      'DEPRECATED (AUTH-03). Legacy single-profile assignment. Token broker resolves by portalHostKey. Retained for historical data only.',
  })
  portalCredentialId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class ReferencedPortalHostDto {
  @ApiProperty({ example: 'gh' })
  key!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Rwanda GeoPortal',
    description: 'Profile display name when a PortalCredential exists',
  })
  name!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://gh.space.gov.rw/portal',
  })
  portalUrl!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    example: true,
    description:
      'True when an active-or-inactive PortalCredential row exists for this key',
  })
  profileConfigured!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Portal authentication is not configured for key "rbc".',
  })
  warning!: string | null;
}

export class ApplicationDetailDto extends ApplicationListItemDto {
  @ApiProperty({
    description: 'Full runtime configuration document',
    type: RuntimeConfigDocumentDto,
  })
  config!: Prisma.JsonValue;

  @ApiProperty({
    required: false,
    nullable: true,
    type: PortalCredentialSummaryDto,
    deprecated: true,
    description:
      'DEPRECATED (AUTH-03). Legacy assigned profile summary. Prefer referencedPortalHosts derived from Runtime Config.',
  })
  portalCredential!: PortalCredentialSummaryDto | null;

  @ApiProperty({
    type: [ReferencedPortalHostDto],
    description:
      'Portal host keys referenced by Application.config (modules[].apps[].portalHostKey), with profile status for Admin warnings.',
  })
  referencedPortalHosts!: ReferencedPortalHostDto[];
}
