import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateApplicationBodyDto {
  @ApiProperty({
    description: 'Immutable kebab-case application key',
    example: 'inspection-hub',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'key must be a lowercase kebab-case identifier (e.g. inspection-hub)',
  })
  key!: string;

  @ApiProperty({
    example: 'National Inspection Hub',
    maxLength: 200,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description:
      'HARM-01 Runtime Config V1 document. Stored as submitted JSON (unknown fields and extensions are preserved). Validated structurally before write; Education-specific sections are not required.',
    type: Object,
    additionalProperties: true,
  })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiProperty({
    required: false,
    description: 'Defaults to true when omitted',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateApplicationBodyDto {
  @ApiProperty({
    required: false,
    example: 'National Inspection Hub',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiProperty({
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'uuid',
    description:
      'Assign an active PortalCredential profile, or null to clear the assignment. Does not appear in public runtime config.',
    example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' || value === undefined ? undefined : value,
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  portalCredentialId?: string | null;
}
