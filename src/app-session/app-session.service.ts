import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  ArcgisPortalClient,
  PortalNetworkError,
} from '../portal/arcgis-portal.client';
import { collectPortalHostKeysFromConfig } from '../portal/portal-host-keys';

export const APP_SESSION_COOKIE = 'rc_app_session';
/** Only the consumer auth + proxy routes need the cookie. */
export const APP_SESSION_COOKIE_PATH = '/api/v1/';
const SESSION_TYPE = 'app-session';
const DEFAULT_SESSION_MINUTES = 480;
const DEFAULT_LOGIN_PORTAL_HOST = 'gh';

export type AppSession = {
  appKey: string;
  username: string;
  /** Browser origin approved at login; portal tokens are bound to it. */
  origin: string;
  expiresAt: number;
};

/**
 * End-user sessions for static mapping SPAs. Users sign in with their own
 * portal account (checked server-side, token discarded); the session is an
 * HttpOnly cookie signed with a key distinct from admin JWTs.
 */
@Injectable()
export class AppSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portalClient: ArcgisPortalClient,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(input: {
    appKey: string;
    username: string;
    password: string;
    origin: string;
  }): Promise<{ cookie: string; session: AppSession }> {
    const application = await this.prisma.application.findUnique({
      where: { key: input.appKey },
      select: { isActive: true, config: true },
    });
    if (!application) {
      throw new NotFoundException(
        `Application with key "${input.appKey}" was not found`,
      );
    }
    if (!application.isActive) {
      throw new ForbiddenException('Application is inactive');
    }

    const loginHost = (
      this.configService.get<string>('APP_LOGIN_PORTAL_HOST') ||
      DEFAULT_LOGIN_PORTAL_HOST
    )
      .trim()
      .toLowerCase();
    if (
      !collectPortalHostKeysFromConfig(application.config).includes(loginHost)
    ) {
      throw new ForbiddenException(
        'Sign-in is not available for this application',
      );
    }
    const credential = await this.prisma.portalCredential.findUnique({
      where: { key: loginHost },
      select: { portalUrl: true, isActive: true },
    });
    if (!credential || !credential.isActive) {
      throw new ForbiddenException(
        'Sign-in is not available for this application',
      );
    }

    try {
      // Proves the user's own portal credentials; the token is discarded.
      await this.portalClient.generateToken({
        portalUrl: credential.portalUrl,
        username: input.username,
        password: input.password,
        referer: input.origin,
        expirationMinutes: 2,
      });
    } catch (error) {
      if (error instanceof PortalNetworkError) {
        throw new ServiceUnavailableException('Unable to reach ArcGIS Portal');
      }
      throw new UnauthorizedException('Invalid username or password');
    }

    const minutes = this.sessionMinutes();
    const session: AppSession = {
      appKey: input.appKey,
      username: input.username,
      origin: input.origin,
      expiresAt: Date.now() + minutes * 60_000,
    };
    const cookie = await this.jwt.signAsync(
      {
        typ: SESSION_TYPE,
        app: session.appKey,
        sub: session.username,
        org: session.origin,
      },
      { secret: this.secret(), expiresIn: `${minutes}m` },
    );
    return { cookie, session };
  }

  /** Returns the session for `appKey`, or null when missing/invalid/expired. */
  async verify(
    cookieHeader: string | undefined,
    appKey: string,
  ): Promise<AppSession | null> {
    const raw = readCookie(cookieHeader, APP_SESSION_COOKIE);
    if (!raw) return null;
    try {
      const payload = await this.jwt.verifyAsync<{
        typ?: string;
        app?: string;
        sub?: string;
        org?: string;
        exp?: number;
      }>(raw, { secret: this.secret() });
      if (
        payload.typ !== SESSION_TYPE ||
        payload.app !== appKey ||
        !payload.sub ||
        !payload.org ||
        !payload.exp
      ) {
        return null;
      }
      return {
        appKey,
        username: payload.sub,
        origin: payload.org,
        expiresAt: payload.exp * 1000,
      };
    } catch {
      return null;
    }
  }

  cookieHeader(value: string, origin: string, maxAgeSec: number): string {
    const secure = origin.startsWith('https:') ? '; Secure' : '';
    const age = Math.max(0, Math.floor(maxAgeSec));
    return `${APP_SESSION_COOKIE}=${value}; HttpOnly; Path=${APP_SESSION_COOKIE_PATH}; SameSite=Lax; Max-Age=${age}${secure}`;
  }

  private sessionMinutes(): number {
    const parsed = Number.parseInt(
      this.configService.get<string>('APP_SESSION_MINUTES') ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed >= 5 && parsed <= 1440
      ? parsed
      : DEFAULT_SESSION_MINUTES;
  }

  /** Derived key so an app session can never pass as an admin JWT. */
  private secret(): string {
    const base =
      this.configService.get<string>('JWT_SECRET') ||
      'test-only-insecure-jwt-secret-32b!';
    return `${base}::${SESSION_TYPE}`;
  }
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim() || null;
    }
  }
  return null;
}
