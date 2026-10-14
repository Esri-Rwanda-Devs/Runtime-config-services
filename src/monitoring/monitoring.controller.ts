import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import type { AuthenticatedAdmin } from '../auth/auth.constants';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import {
  MonitorAlertDeliveryDto,
  MonitorHistoryDto,
  MonitorHistoryQueryDto,
  MonitorRunStartedDto,
  MonitorStatusDto,
} from './dto/monitoring.dto';
import { MonitorAlertService } from './monitor-alert.service';
import { MonitorRunnerService } from './monitor-runner.service';
import { MonitoringService } from './monitoring.service';

@ApiTags('Admin Monitoring')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing/invalid/expired token, or admin no longer exists',
})
@ApiForbiddenResponse({ description: 'Inactive admin or insufficient role' })
@Controller('api/v1/admin/monitoring')
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly runner: MonitorRunnerService,
    private readonly alerts: MonitorAlertService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Latest result of every status check',
    description:
      'Results of the last finished monitor run with 24 h / 7 d uptime per check. Details are sanitized and never include tokens.',
  })
  @ApiOkResponse({ type: MonitorStatusDto })
  status(): Promise<MonitorStatusDto> {
    return this.monitoring.status();
  }

  @Get('history')
  @ApiOperation({ summary: 'Results over time for one check target' })
  @ApiOkResponse({ type: MonitorHistoryDto })
  history(@Query() query: MonitorHistoryQueryDto): Promise<MonitorHistoryDto> {
    return this.monitoring.history({
      checkType: query.checkType,
      targetKey: query.targetKey,
      hours: query.hours ?? 24,
    });
  }

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start a monitor run now',
    description:
      'Runs in the background; poll status until running is false. Read-only towards portals.',
  })
  @ApiAcceptedResponse({ type: MonitorRunStartedDto })
  @ApiConflictResponse({ description: 'A run is already in progress' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async run(
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<MonitorRunStartedDto> {
    const runId = await this.runner.start('manual', admin.email);
    if (!runId) {
      throw new ConflictException('A status check run is already in progress');
    }
    return { runId };
  }

  @Post('test-alert')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Send a test alert email to the configured recipients',
  })
  @ApiOkResponse({ type: MonitorAlertDeliveryDto })
  @ApiBadRequestResponse({ description: 'Email alerts are not configured' })
  @ApiBadGatewayResponse({ description: 'The mail server refused or failed' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async testAlert(
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<MonitorAlertDeliveryDto> {
    if (!this.alerts.settings.configured) {
      throw new BadRequestException(
        this.alerts.settings.error
          ? `Email alerts are not configured: ${this.alerts.settings.error}`
          : 'Email alerts are not configured',
      );
    }
    const delivery = await this.alerts.sendTest(admin.email);
    if (!delivery.ok) {
      throw new BadGatewayException(
        `Test email failed: ${delivery.error ?? 'unknown error'}`,
      );
    }
    return delivery;
  }
}
