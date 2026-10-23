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
import { PortalCredentialCryptoService } from '../portal/portal-credential-crypto.service';

export const APP_SESSION_COOKIE = 'rc_app_session';
/**
 * Each app keeps its own cookie (rc_app_session_<appKey>) so several apps on
 * one origin can be signed in at once. The unsuffixed cookie is still read
 * (and cleared) for sessions issued before the split.
 */
export function appSessionCookieName(appKey: string): string {
  return `${APP_SESSION_COOKIE}_${appKey}`;
}
const APP_SESSION_COOKIE_NAME_PATTERN =
  /^rc_app_session_[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
  /** The user's own portal token, encrypted; absent on older sessions. */
  portalToken?: string;
};

/** The signed-in user's own portal token, for standalone apps on the origin. */
export type UserPortalToken = {
  token: string;
  expiresAt: number;
  portalUrl: string;
  username: string;
};

/**
 * End-user sessions for static mapping SPAs. Users sign in with their own
 * portal account (checked server-side); the session is an HttpOnly cookie
 * signed with a key distinct from admin JWTs. It carries the user's own
 * portal token, encrypted, for the standalone apps (see app-launch.controller.ts).
 */
@Injectable()
export class AppSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portalClient: ArcgisPortalClient,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
    private readonly crypto: PortalCredentialCryptoService,
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

    // Users always sign in with their account on the login portal (GeoHub),
    // even when the app's dashboards live on other portals; which portals the
    // proxy may reach is still decided per app by its config.
    const loginHost = (
      this.configService.get<string>('APP_LOGIN_PORTAL_HOST') ||
      DEFAULT_LOGIN_PORTAL_HOST
    )
      .trim()
      .toLowerCase();
    const credential = await this.prisma.portalCredential.findUnique({
      where: { key: loginHost },
      select: { portalUrl: true, isActive: true },
    });
    if (!credential || !credential.isActive) {
      throw new ForbiddenException(
        'Sign-in is not available for this application',
      );
    }

    const minutes = this.sessionMinutes();
    // Only shells that link to a standalone app keep the user's token; for the
    // rest it just proves the credentials and is discarded.
    const keepToken = linksStandaloneApps(application.config, input.appKey);
    let issued: { token: string; expiresAt: number };
    try {
      // A kept token is encrypted and only handed to the standalone apps that
      // call the portal themselves; the proxy keeps using the service account.
      issued = await this.portalClient.generateToken({
        portalUrl: credential.portalUrl,
        username: input.username,
        password: input.password,
        referer: input.origin,
        expirationMinutes: keepToken ? minutes : 2,
      });
    } catch (error) {
      if (error instanceof PortalNetworkError) {
        throw new ServiceUnavailableException('Unable to reach ArcGIS Portal');
      }
      throw new UnauthorizedException('Invalid username or password');
    }

    const session: AppSession = {
      appKey: input.appKey,
      username: input.username,
      origin: input.origin,
      expiresAt: Date.now() + minutes * 60_000,
      ...(keepToken
        ? {
            portalToken: this.crypto.encrypt(
              JSON.stringify({
                t: issued.token,
                // The portal may cap the lifetime below the session's.
                e: issued.expiresAt || Date.now() + minutes * 60_000,
                p: credential.portalUrl,
              }),
            ),
          }
        : {}),
    };
    const cookie = await this.jwt.signAsync(
      {
        typ: SESSION_TYPE,
        app: session.appKey,
        sub: session.username,
        org: session.origin,
        ptk: session.portalToken,
      },
      { secret: this.secret(), expiresIn: `${minutes}m` },
    );
    return { cookie, session };
  }

  /** Decrypts the session's portal token; null when absent, broken or expired. */
  userPortalToken(session: AppSession): UserPortalToken | null {
    if (!session.portalToken) return null;
    try {
      const value = JSON.parse(this.crypto.decrypt(session.portalToken)) as {
        t?: unknown;
        e?: unknown;
        p?: unknown;
      };
      if (
        typeof value.t !== 'string' ||
        typeof value.e !== 'number' ||
        typeof value.p !== 'string' ||
        value.e <= Date.now()
      ) {
        return null;
      }
      return {
        token: value.t,
        expiresAt: Math.min(value.e, session.expiresAt),
        portalUrl: value.p,
        username: session.username,
      };
    } catch {
      return null;
    }
  }

  /** Returns the session for `appKey`, or null when missing/invalid/expired. */
  async verify(
    cookieHeader: string | undefined,
    appKey: string,
  ): Promise<AppSession | null> {
    const raw =
      readCookie(cookieHeader, appSessionCookieName(appKey)) ||
      readCookie(cookieHeader, APP_SESSION_COOKIE);
    if (!raw) return null;
    try {
      const payload = await this.jwt.verifyAsync<{
        typ?: string;
        app?: string;
        sub?: string;
        org?: string;
        exp?: number;
        ptk?: unknown;
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
        ...(typeof payload.ptk === 'string'
          ? { portalToken: payload.ptk }
          : {}),
      };
    } catch {
      return null;
    }
  }

  cookieHeader(
    name: string,
    value: string,
    origin: string,
    maxAgeSec: number,
  ): string {
    const secure = origin.startsWith('https:') ? '; Secure' : '';
    const age = Math.max(0, Math.floor(maxAgeSec));
    return `${name}=${value}; HttpOnly; Path=${APP_SESSION_COOKIE_PATH}; SameSite=Lax; Max-Age=${age}${secure}`;
  }

  /**
   * Expiring Set-Cookie headers for logout: the app's own cookie (or, without
   * an appKey, every app session cookie the browser sent) plus the legacy one.
   */
  clearCookieHeaders(
    cookieHeader: string | undefined,
    origin: string,
    appKey?: string,
  ): string[] {
    const names = new Set<string>([APP_SESSION_COOKIE]);
    if (appKey) {
      names.add(appSessionCookieName(appKey));
    } else {
      for (const name of cookieNames(cookieHeader)) {
        if (APP_SESSION_COOKIE_NAME_PATTERN.test(name)) names.add(name);
      }
    }
    return [...names].map((name) => this.cookieHeader(name, '', origin, 0));
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

/** True when the app's config frames /api/v1/app-launch/<appKey>/... anywhere. */
export function linksStandaloneApps(config: unknown, appKey: string): boolean {
  if (config === null || config === undefined) return false;
  return JSON.stringify(config).includes(`/api/v1/app-launch/${appKey}/`);
}

function cookieNames(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(';')
    .map((part) => part.slice(0, Math.max(0, part.indexOf('='))).trim())
    .filter((name) => name.length > 0);
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
