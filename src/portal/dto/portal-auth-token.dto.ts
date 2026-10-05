import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class PortalAuthTokenBodyDto {
  @ApiProperty({
    description:
      'Application key identifying the consuming SPA. Not a secret — access is gated by Origin allowlist, active application, and Runtime Config host authorization.',
    example: 'education-mapping',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'appKey must be a lowercase kebab-case identifier (e.g. education-mapping)',
  })
  appKey!: string;

  @ApiProperty({
    description:
      'Logical Portal host key matching PortalCredential.key and catalog item portalHostKey (e.g. gh). Must be referenced by the application Runtime Config. Not a secret.',
    example: 'gh',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'portalHostKey must be a lowercase kebab-case identifier (e.g. gh, rbc)',
  })
  portalHostKey!: string;
}

export class PortalAuthTokenResponseDto {
  @ApiProperty({
    description: 'Short-lived ArcGIS Portal token',
    example: 'AbCdEf...',
  })
  token!: string;

  @ApiProperty({
    description: 'Token expiry as Unix epoch milliseconds',
    example: 1790000000000,
  })
  expiresAt!: number;

  @ApiProperty({
    description: 'Referer value bound into the ArcGIS token (approved Origin)',
    example: 'https://localhost:5174',
  })
  referer!: string;

  @ApiProperty({
    description: 'Normalized Portal base URL used for generateToken',
    example: 'https://gh.space.gov.rw/portal',
  })
  portalUrl!: string;

  @ApiProperty({
    description: 'Logical Portal host key that was resolved',
    example: 'gh',
  })
  portalHostKey!: string;
}
