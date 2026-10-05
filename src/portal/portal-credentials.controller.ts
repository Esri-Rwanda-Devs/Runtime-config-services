import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import type { AuthenticatedAdmin } from '../auth/auth.constants';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { NotFoundResponseDto } from '../config/dto/not-found-response.dto';
import {
  CreatePortalCredentialBodyDto,
  PortalCredentialIdParamDto,
  PortalCredentialSummaryDto,
  PortalCredentialTestResultDto,
  RotatePortalPasswordBodyDto,
  TestPortalCredentialInlineBodyDto,
  UpdatePortalCredentialBodyDto,
} from './dto/portal-credential.dto';
import { PortalCredentialsService } from './portal-credentials.service';

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

@ApiTags('Admin Portal Credentials')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing/invalid/expired token, or admin no longer exists',
})
@ApiForbiddenResponse({
  description: 'Authenticated but inactive admin or insufficient role',
})
@Controller('api/v1/admin/portal-credentials')
export class PortalCredentialsController {
  constructor(
    private readonly portalCredentialsService: PortalCredentialsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List Portal authentication profiles',
    description:
      'Returns metadata only. Never returns password or encryptedPassword.',
  })
  @ApiOkResponse({ type: [PortalCredentialSummaryDto] })
  list(): Promise<PortalCredentialSummaryDto[]> {
    return this.portalCredentialsService.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create Portal authentication profile',
    description:
      'Encrypts and stores the Portal password. Password is never returned.',
  })
  @ApiCreatedResponse({ type: PortalCredentialSummaryDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  create(
    @Body() body: CreatePortalCredentialBodyDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<PortalCredentialSummaryDto> {
    return this.portalCredentialsService.create(
      {
        key: body.key,
        name: body.name,
        portalUrl: body.portalUrl,
        username: body.username,
        password: body.password,
        isActive: body.isActive,
      },
      actor,
    );
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test Portal credentials without saving',
    description:
      'Authenticates against ArcGIS generateToken, discards the token, and never stores the password. Use before password rotation.',
  })
  @ApiOkResponse({ type: PortalCredentialTestResultDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  testInline(
    @Body() body: TestPortalCredentialInlineBodyDto,
    @Headers('origin') origin: string | undefined,
    @Req() req: { protocol?: string; headers: { host?: string } },
  ): Promise<PortalCredentialTestResultDto> {
    const referer = this.resolveAdminReferer(origin, req);
    return this.portalCredentialsService.testInline(
      {
        portalUrl: body.portalUrl,
        username: body.username,
        password: body.password,
      },
      referer,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Portal authentication profile',
    description:
      'Returns metadata only. passwordConfigured indicates a password is stored.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PortalCredentialSummaryDto })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  getById(
    @Param() params: PortalCredentialIdParamDto,
  ): Promise<PortalCredentialSummaryDto> {
    return this.portalCredentialsService.getById(params.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Portal authentication profile metadata',
    description:
      'Updates name, portalUrl, username, and/or isActive. Does not change the password.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PortalCredentialSummaryDto })
  @ApiBadRequestResponse({ description: 'Invalid body or empty patch' })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  update(
    @Param() params: PortalCredentialIdParamDto,
    @Body() body: UpdatePortalCredentialBodyDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<PortalCredentialSummaryDto> {
    return this.portalCredentialsService.update(
      params.id,
      {
        name: body.name,
        portalUrl: body.portalUrl,
        username: body.username,
        isActive: body.isActive,
      },
      actor,
    );
  }

  @Put(':id/password')
  @ApiOperation({
    summary: 'Replace Portal password',
    description:
      'Rotates the encrypted password for an existing profile. Prefer testing credentials first via POST .../test (inline).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PortalCredentialSummaryDto })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  rotatePassword(
    @Param() params: PortalCredentialIdParamDto,
    @Body() body: RotatePortalPasswordBodyDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
  ): Promise<PortalCredentialSummaryDto> {
    return this.portalCredentialsService.rotatePassword(
      params.id,
      body.password,
      actor,
    );
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test stored Portal credentials',
    description:
      'Decrypts the stored password, calls ArcGIS generateToken, discards the token. Never returns the token or password.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PortalCredentialTestResultDto })
  @ApiNotFoundResponse({ type: NotFoundResponseDto })
  testStored(
    @Param() params: PortalCredentialIdParamDto,
    @Headers('origin') origin: string | undefined,
    @Req() req: { protocol?: string; headers: { host?: string } },
  ): Promise<PortalCredentialTestResultDto> {
    const referer = this.resolveAdminReferer(origin, req);
    return this.portalCredentialsService.testStored(params.id, referer);
  }

  /**
   * Prefer a configured Admin UI origin; fall back to request Origin or first ALLOWED_ORIGINS.
   * Sent to ArcGIS as client=referer referer value.
   */
  private resolveAdminReferer(
    origin: string | undefined,
    req: { protocol?: string; headers: { host?: string } },
  ): string {
    const allowed = parseAllowedOrigins(
      this.configService.get<string>('ALLOWED_ORIGINS'),
    );
    if (origin && allowed.includes(origin)) {
      return origin;
    }
    if (allowed.length > 0) {
      return allowed[0];
    }
    if (origin) {
      return origin;
    }
    const host = req.headers.host || 'localhost';
    const proto = req.protocol || 'http';
    return `${proto}://${host}`;
  }
}
