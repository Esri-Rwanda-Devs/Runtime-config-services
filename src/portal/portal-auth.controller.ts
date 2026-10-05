import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  PortalAuthTokenBodyDto,
  PortalAuthTokenResponseDto,
} from './dto/portal-auth-token.dto';
import { PortalAuthTokenService } from './portal-auth-token.service';

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

@ApiTags('Portal Auth (Consumer)')
@Controller('api/v1/portal-auth')
export class PortalAuthController {
  constructor(
    private readonly portalAuthTokenService: PortalAuthTokenService,
    private readonly configService: ConfigService,
  ) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Issue a short-lived ArcGIS Portal token for an application + portal host',
    description: [
      'Consumer token broker for mapping SPAs (AUTH-03 host-aware resolution).',
      '',
      'Request body:',
      '- appKey: identifies the consuming application (e.g. education-mapping).',
      '- portalHostKey: identifies the Portal profile (e.g. gh). Must match',
      '  PortalCredential.key and must be referenced by the application Runtime',
      '  Config (modules[].apps[].portalHostKey).',
      '',
      'Security (V1):',
      '- Requires browser Origin header present and listed in ALLOWED_ORIGINS.',
      '- Requires active Application.',
      '- Requires portalHostKey to appear in Application.config catalog items.',
      '- Resolves PortalCredential by key (not Application.portalCredentialId).',
      '- appKey / portalHostKey are NOT secrets; Origin allowlisting + host',
      '  authorization + rate limiting are the primary gates.',
      '- ArcGIS token is bound with client=referer using the approved Origin.',
      '- Never returns username, password, or encryption material.',
      '- Token is short-lived (PORTAL_TOKEN_EXPIRATION_MINUTES).',
      '',
      'Limitation: a public SPA cannot cryptographically prove its identity;',
      'anyone who can call this API from an allowed Origin can mint tokens for',
      'hosts that application config references. Do not treat keys as auth.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: PortalAuthTokenResponseDto })
  @ApiBadRequestResponse({
    description: 'Missing/invalid Origin or invalid appKey/portalHostKey',
  })
  @ApiUnauthorizedResponse({
    description: 'Portal rejected the stored credentials',
  })
  @ApiForbiddenResponse({
    description:
      'Inactive application, host not referenced by config, inactive/missing profile',
  })
  @ApiNotFoundResponse({ description: 'Unknown appKey' })
  @ApiServiceUnavailableResponse({
    description: 'Portal unreachable or decrypt failure',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async issueToken(
    @Body() body: PortalAuthTokenBodyDto,
    @Headers('origin') origin: string | undefined,
  ): Promise<PortalAuthTokenResponseDto> {
    const allowed = parseAllowedOrigins(
      this.configService.get<string>('ALLOWED_ORIGINS'),
    );

    if (!origin || !origin.trim()) {
      throw new BadRequestException(
        'Origin header is required for portal token requests',
      );
    }

    if (!allowed.includes(origin)) {
      throw new BadRequestException(
        'Origin is not allowed for portal token requests',
      );
    }

    return this.portalAuthTokenService.issueToken({
      appKey: body.appKey,
      portalHostKey: body.portalHostKey,
      origin,
    });
  }
}
