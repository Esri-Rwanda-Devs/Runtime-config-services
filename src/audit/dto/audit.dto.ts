import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationAuditAction, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeAdminEmail } from '../../auth/auth.constants';

export class AuditApplicationRefDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  id!: string | null;

  @ApiProperty({ example: 'education-mapping' })
  key!: string;
}

export class AuditActorRefDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  id!: string | null;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;
}

export class AuditLogItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: AuditApplicationRefDto })
  application!: AuditApplicationRefDto;

  @ApiProperty({ type: AuditActorRefDto })
  actor!: AuditActorRefDto;

  @ApiProperty({ enum: ApplicationAuditAction })
  action!: ApplicationAuditAction;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Prior state snapshot; null for APPLICATION_CREATED',
    type: Object,
    additionalProperties: true,
  })
  before!: Prisma.JsonValue | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'New state snapshot',
    type: Object,
    additionalProperties: true,
  })
  after!: Prisma.JsonValue | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogItemDto] })
  items!: AuditLogItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;

  @ApiProperty({ example: 0 })
  totalPages!: number;
}

export class GlobalAuditLogsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'education-mapping',
    description: 'Filter by application key snapshot',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'applicationKey must be a lowercase kebab-case identifier (e.g. education-mapping)',
  })
  applicationKey?: string;

  @ApiPropertyOptional({ enum: ApplicationAuditAction })
  @IsOptional()
  @IsEnum(ApplicationAuditAction)
  action?: ApplicationAuditAction;

  @ApiPropertyOptional({
    example: 'admin@example.com',
    description: 'Filter by actor email snapshot (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeAdminEmail(value) : value,
  )
  actorEmail?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound (ISO-8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound (ISO-8601)',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

export class ApplicationAuditLogsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ApplicationAuditAction })
  @IsOptional()
  @IsEnum(ApplicationAuditAction)
  action?: ApplicationAuditAction;

  @ApiPropertyOptional({
    example: 'admin@example.com',
    description: 'Filter by actor email snapshot (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeAdminEmail(value) : value,
  )
  actorEmail?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound (ISO-8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound (ISO-8601)',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
