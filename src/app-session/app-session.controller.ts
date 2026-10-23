import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  AppKeyBodyDto,
  AppLoginBodyDto,
  OptionalAppKeyQueryDto,
} from './dto/app-login.dto';
import { AppSessionService, appSessionCookieName } from './app-session.service';
import { SessionThrottlerGuard } from './session-throttler.guard';

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

@ApiTags('App Auth (Consumer)')
@Controller('api/v1/app-auth')
export class AppSessionController {
  constructor(
    private readonly sessions: AppSessionService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Sign a user in to a static mapping app with their own portal account',
    description:
      "Requires an allowed Origin. Sets an HttpOnly session cookie used by /api/v1/portal-proxy. No portal token is returned; for apps whose config links to /api/v1/app-launch the cookie carries the user's own token, encrypted, for /api/v1/app-auth/portal-token.",
  })
  async login(
    @Body() body: AppLoginBodyDto,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const approved = this.requireAllowedOrigin(origin);
    const { cookie, session } = await this.sessions.login({
      appKey: body.appKey,
      username: body.username,
      password: body.password,
      origin: approved,
    });
    res.setHeader(
      'Set-Cookie',
      this.sessions.cookieHeader(
        appSessionCookieName(session.appKey),
        cookie,
        approved,
        (session.expiresAt - Date.now()) / 1000,
      ),
    );
    res.setHeader('Cache-Control', 'no-store');
    return {
      authenticated: true,
      user: { username: session.username },
      expiresAt: session.expiresAt,
    };
  }

  @Get('session')
  @ApiOperation({ summary: 'Current app session (401 when signed out)' })
  async session(
    @Query() query: AppKeyBodyDto,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const session = await this.sessions.verify(cookie, query.appKey);
    if (!session) {
      throw new UnauthorizedException('Application login required');
    }
    return {
      authenticated: true,
      user: { username: session.username },
      expiresAt: session.expiresAt,
    };
  }

  @Post('portal-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "The signed-in user's own portal token, for same-origin apps",
    description:
      'For standalone apps that call the portal themselves (handed over by /api/v1/app-launch). Requires the session, the Origin it was signed in from, X-Requested-With: fetch and (when sent) Sec-Fetch-Site: same-origin. Never the service account.',
  })
  async portalToken(
    @Body() body: AppKeyBodyDto,
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-requested-with') requestedWith: string | undefined,
    @Headers('sec-fetch-site') fetchSite: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    // Script-only: forms, links and same-site pages cannot send these.
    if (
      requestedWith !== 'fetch' ||
      (fetchSite !== undefined && fetchSite !== 'same-origin')
    ) {
      throw new ForbiddenException('Not available to this request');
    }
    const approved = this.requireAllowedOrigin(origin);
    const session = await this.sessions.verify(cookie, body.appKey);
    if (!session || session.origin !== approved) {
      throw new UnauthorizedException('Application login required');
    }
    const issued = this.sessions.userPortalToken(session);
    if (!issued) {
      // Sessions from before tokens were kept, or the token outlived by the session.
      throw new UnauthorizedException('Sign in again to open this app');
    }
    return {
      token: issued.token,
      expires: issued.portalExpiresAt,
      userId: issued.username,
      server: issued.portalUrl,
      ssl: issued.portalUrl.startsWith('https:'),
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear the app session cookie (all app sessions when appKey is omitted)',
  })
  logout(
    @Query() query: OptionalAppKeyQueryDto,
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const approved = this.requireAllowedOrigin(origin);
    res.setHeader(
      'Set-Cookie',
      this.sessions.clearCookieHeaders(cookie, approved, query.appKey),
    );
    return { authenticated: false };
  }

  private requireAllowedOrigin(origin: string | undefined): string {
    const allowed = parseAllowedOrigins(
      this.configService.get<string>('ALLOWED_ORIGINS'),
    );
    if (!origin || !allowed.includes(origin)) {
      throw new BadRequestException('Origin is not allowed');
    }
    return origin;
  }
}
