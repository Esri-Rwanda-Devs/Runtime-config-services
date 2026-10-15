import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CHECK_TYPES } from '../monitor-checks';

export class MonitorHistoryQueryDto {
  @ApiProperty({ enum: CHECK_TYPES })
  @IsIn(CHECK_TYPES)
  checkType!: string;

  @ApiProperty({ example: 'health-mapping/rbc' })
  @IsString()
  @MaxLength(300)
  targetKey!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 168, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;
}

export class MonitorSettingsDto {
  @ApiProperty({ description: 'Scheduled runs on (MONITOR_ENABLED)' })
  enabled!: boolean;

  @ApiProperty()
  intervalMs!: number;

  @ApiProperty({ description: 'Apps listed in MONITOR_APP_URLS' })
  appUrlsConfigured!: number;

  @ApiProperty({ nullable: true, type: String })
  appUrlsError!: string | null;

  @ApiProperty()
  redAfterFailures!: number;
}

export class MonitorAlertDeliveryDto {
  @ApiProperty()
  at!: string;

  @ApiProperty({ enum: ['alert', 'test', 'summary'] })
  kind!: string;

  @ApiProperty()
  ok!: boolean;

  @ApiProperty({ nullable: true, type: String })
  error!: string | null;
}

export class MonitorAlertsDto {
  @ApiProperty({ description: 'SMTP host, sender and recipients are set' })
  configured!: boolean;

  @ApiProperty({ nullable: true, type: String })
  error!: string | null;

  @ApiProperty({ type: [String] })
  recipients!: string[];

  @ApiProperty({
    description: 'Reminder interval while a check stays red; 0 = off',
  })
  remindHours!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'UTC hour of the daily summary email; null = off',
  })
  summaryHourUtc!: number | null;

  @ApiProperty({ type: MonitorAlertDeliveryDto, nullable: true })
  lastDelivery!: MonitorAlertDeliveryDto | null;
}

export class MonitorRunSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['schedule', 'manual'] })
  trigger!: string;

  @ApiProperty()
  startedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  finishedAt!: string | null;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  failed!: number;
}

export class MonitorCheckDto {
  @ApiProperty({ enum: CHECK_TYPES })
  checkType!: string;

  @ApiProperty()
  targetKey!: string;

  @ApiProperty()
  targetLabel!: string;

  @ApiProperty({ enum: ['PASS', 'WARN', 'FAIL', 'SKIP'] })
  outcome!: string;

  @ApiProperty({
    enum: ['green', 'amber', 'red', 'grey'],
    description: 'Red only after redAfterFailures failures in a row',
  })
  status!: string;

  @ApiProperty({ nullable: true, type: Number })
  latencyMs!: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Sanitized; never a token',
  })
  detail!: string | null;

  @ApiProperty({ nullable: true, type: Object, additionalProperties: true })
  meta!: Record<string, unknown> | null;

  @ApiProperty()
  consecutiveFailures!: number;

  @ApiProperty({ nullable: true, type: String })
  failingSince!: string | null;

  @ApiProperty()
  checkedAt!: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Percent, SKIP excluded',
  })
  uptime24h!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  uptime7d!: number | null;
}

export class MonitorStatusDto {
  @ApiProperty({ type: MonitorSettingsDto })
  settings!: MonitorSettingsDto;

  @ApiProperty({ type: MonitorAlertsDto })
  alerts!: MonitorAlertsDto;

  @ApiProperty()
  running!: boolean;

  @ApiProperty({ description: 'No finished run within staleAfterMs' })
  stale!: boolean;

  @ApiProperty()
  staleAfterMs!: number;

  @ApiProperty({ type: MonitorRunSummaryDto, nullable: true })
  lastRun!: MonitorRunSummaryDto | null;

  @ApiProperty({ type: [MonitorCheckDto] })
  checks!: MonitorCheckDto[];
}

export class MonitorHistoryItemDto {
  @ApiProperty({ enum: ['PASS', 'WARN', 'FAIL', 'SKIP'] })
  outcome!: string;

  @ApiProperty({ enum: ['green', 'amber', 'red', 'grey'] })
  status!: string;

  @ApiProperty({ nullable: true, type: Number })
  latencyMs!: number | null;

  @ApiProperty({ nullable: true, type: String })
  detail!: string | null;

  @ApiProperty()
  checkedAt!: string;
}

export class MonitorHistoryDto {
  @ApiProperty()
  checkType!: string;

  @ApiProperty()
  targetKey!: string;

  @ApiProperty({ type: [MonitorHistoryItemDto] })
  items!: MonitorHistoryItemDto[];
}

export class MonitorRunStartedDto {
  @ApiProperty({ format: 'uuid' })
  runId!: string;
}
