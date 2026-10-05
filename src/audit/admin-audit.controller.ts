import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { AuditService } from './audit.service';
import { AuditLogPageDto, GlobalAuditLogsQueryDto } from './dto/audit.dto';

@ApiTags('Admin Audit')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing/invalid/expired token, or admin no longer exists',
})
@ApiForbiddenResponse({
  description: 'Authenticated but inactive admin or insufficient role',
})
@Controller('api/v1/admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List configuration audit history (platform-wide)',
    description:
      'Append-only mutation history for application management. Newest first. Requires Bearer JWT for an active AdminUser.',
  })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiBadRequestResponse({
    description: 'Invalid pagination or filter parameters',
  })
  listAuditLogs(
    @Query() query: GlobalAuditLogsQueryDto,
  ): Promise<AuditLogPageDto> {
    return this.auditService.listAuditLogs({
      applicationKey: query.applicationKey,
      action: query.action,
      actorEmail: query.actorEmail,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }
}
