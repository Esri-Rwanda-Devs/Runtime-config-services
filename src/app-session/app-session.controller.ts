import {
  BadRequestException,
  Body,
  Controller,
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
import { AppKeyBodyDto, AppLoginBodyDto } from './dto/app-login.dto';
import { AppSessionService } from './app-session.service';

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
      'Requires an allowed Origin. Sets an HttpOnly session cookie used by /api/v1/portal-proxy. No portal token is returned.',
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

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the app session cookie' })
  logout(
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const approved = this.requireAllowedOrigin(origin);
    res.setHeader('Set-Cookie', this.sessions.cookieHeader('', approved, 0));
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
