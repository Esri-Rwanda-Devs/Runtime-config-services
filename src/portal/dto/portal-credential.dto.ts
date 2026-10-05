import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PortalCredentialSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'Immutable logical host key referenced by Runtime Config portalHostKey',
    example: 'gh',
  })
  key!: string;

  @ApiProperty({ example: 'Rwanda GeoPortal' })
  name!: string;

  @ApiProperty({ example: 'https://gh.space.gov.rw/portal' })
  portalUrl!: string;

  @ApiProperty({ example: 'service-account' })
  username!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    description:
      'True when an encrypted password is stored. Never returns the password.',
    example: true,
  })
  passwordConfigured!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class CreatePortalCredentialBodyDto {
  @ApiProperty({
    description:
      'Immutable logical host key (lowercase kebab-case). Cannot be changed after create.',
    example: 'gh',
    maxLength: 64,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'key must be a lowercase kebab-case identifier (e.g. gh, rbc, gis-rbc)',
  })
  key!: string;

  @ApiProperty({ example: 'Rwanda GeoPortal', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    example: 'https://gh.space.gov.rw/portal',
    maxLength: 500,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsUrl({ require_tld: false, require_protocol: true })
  portalUrl!: string;

  @ApiProperty({ example: 'service-account', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username!: string;

  @ApiProperty({
    description: 'Portal password. Stored encrypted; never returned by GET.',
    format: 'password',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(500)
  password!: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePortalCredentialBodyDto {
  @ApiPropertyOptional({ example: 'Rwanda GeoPortal', maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: 'https://gh.space.gov.rw/portal',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsUrl({ require_tld: false, require_protocol: true })
  portalUrl?: string;

  @ApiPropertyOptional({ example: 'service-account', maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RotatePortalPasswordBodyDto {
  @ApiProperty({
    description: 'New Portal password. Replaces the encrypted stored value.',
    format: 'password',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(500)
  password!: string;
}

export class TestPortalCredentialInlineBodyDto {
  @ApiProperty({ example: 'https://gh.space.gov.rw/portal' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsUrl({ require_tld: false, require_protocol: true })
  portalUrl!: string;

  @ApiProperty({ example: 'service-account' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(500)
  password!: string;
}

export class PortalCredentialIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class PortalCredentialTestResultDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Portal credentials verified.' })
  message!: string;
}

/** Nullable UUID helper removed — validation lives on UpdateApplicationBodyDto. */
