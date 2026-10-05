import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import type { AuthenticatedAdmin } from '../auth/auth.constants';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AuditService } from '../audit/audit.service';
import {
  ApplicationAuditLogsQueryDto,
  AuditLogPageDto,
} from '../audit/dto/audit.dto';
import { AppKeyParamDto } from '../config/dto/app-key.param.dto';
import { ConflictResponseDto } from '../config/dto/conflict-response.dto';
import { NotFoundResponseDto } from '../config/dto/not-found-response.dto';
import { RuntimeConfigDocumentDto } from '../config/dto/runtime-config.dto';
import { AdminApplicationsService } from './admin-applications.service';
import {
  ApplicationDetailDto,
  ApplicationListItemDto,
} from './dto/application.dto';
import {
  CreateApplicationBodyDto,
  UpdateApplicationBodyDto,
} from './dto/create-update.dto';

@ApiTags('Admin Applications')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing/invalid/expired token, or admin no longer exists',
})
@ApiForbiddenResponse({
  description: 'Authenticated but inactive admin or insufficient role',
})
@Controller('api/v1/admin/applications')
export class AdminApplicationsController {
  constructor(
    private readonly adminApplicationsService: AdminApplicationsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List applications (registry metadata)',
    description:
      'Requires Bearer JWT for an active AdminUser. Returns registry metadata only (no config payloads).',
  })
  @ApiOkResponse({ type: [ApplicationListItemDto] })
  listApplications(): Promise<ApplicationListItemDto[]> {
    return this.adminApplicationsService.listApplications();
  }

  @Get(':appKey/audit-logs')
  @ApiTags('Admin Audit')
  @ApiOperation({
    summary: 'List audit history for one application',
    description:
      'Returns append-only mutation history for the given application key. Empty history returns 200 with items=[]. Unknown application returns 404.',
  })
  @ApiParam({
    name: 'appKey',
    example: 'education-mapping',
    description: 'Immutable application key',
  })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiBadRequestResponse({
    description: 'Invalid appKey format or filter parameters',
  })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  async listApplicationAuditLogs(
    @Param() params: AppKeyParamDto,
    @Query() query: ApplicationAuditLogsQueryDto,
  ): Promise<AuditLogPageDto> {
    await this.adminApplicationsService.getApplication(params.appKey);
    return this.auditService.listAuditLogs({
      applicationKey: params.appKey,
      action: query.action,
      actorEmail: query.actorEmail,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Get(':appKey')
  @ApiOperation({
    summary: 'Get application detail including config',
    description: 'Requires Bearer JWT for an active AdminUser.',
  })
  @ApiParam({
    name: 'appKey',
    example: 'education-mapping',
    description: 'Immutable application key',
  })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid appKey format' })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  getApplication(
    @Param() params: AppKeyParamDto,
  ): Promise<ApplicationDetailDto> {
    return this.adminApplicationsService.getApplication(params.appKey);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create application',
    description:
      'Requires Bearer JWT for an active AdminUser. appKey is immutable after creation. Writes APPLICATION_CREATED audit in the same transaction.',
  })
  @ApiCreatedResponse({ type: ApplicationDetailDto })
  @ApiBadRequestResponse({
    description: 'Invalid body or malformed runtime config document',
  })
  @ApiConflictResponse({ type: ConflictResponseDto })
  createApplication(
    @Body() body: CreateApplicationBodyDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<ApplicationDetailDto> {
    return this.adminApplicationsService.createApplication(
      {
        key: body.key,
        name: body.name,
        config: body.config,
        isActive: body.isActive,
      },
      actor,
    );
  }

  @Patch(':appKey')
  @ApiOperation({
    summary: 'Update application metadata',
    description:
      'Requires Bearer JWT for an active AdminUser. Updates name, isActive, and/or portalCredentialId. appKey and config cannot be changed here. Writes audit row(s) when state actually changes.',
  })
  @ApiParam({
    name: 'appKey',
    example: 'education-mapping',
  })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiBadRequestResponse({
    description: 'Invalid body, empty patch, or forbidden fields',
  })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  updateApplication(
    @Param() params: AppKeyParamDto,
    @Body() body: UpdateApplicationBodyDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<ApplicationDetailDto> {
    return this.adminApplicationsService.updateApplicationMetadata(
      params.appKey,
      {
        name: body.name,
        isActive: body.isActive,
        portalCredentialId: body.portalCredentialId,
      },
      actor,
    );
  }

  @Put(':appKey/config')
  @ApiOperation({
    summary: 'Replace runtime configuration document',
    description:
      'Requires Bearer JWT for an active AdminUser. Request body is the config document DIRECTLY (no { config: ... } wrapper). Full replacement, not merge. Writes APPLICATION_CONFIG_REPLACED audit in the same transaction.',
  })
  @ApiParam({
    name: 'appKey',
    example: 'education-mapping',
  })
  @ApiBody({ type: RuntimeConfigDocumentDto })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiBadRequestResponse({
    description: 'Malformed runtime config document',
  })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  replaceConfig(
    @Param() params: AppKeyParamDto,
    @Body() body: Record<string, unknown>,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<ApplicationDetailDto> {
    return this.adminApplicationsService.replaceConfig(
      params.appKey,
      body,
      actor,
    );
  }
}
