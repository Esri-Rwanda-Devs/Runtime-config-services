import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ArcgisPortalClient,
  PortalAuthError,
  PortalNetworkError,
  PortalResponseError,
} from './arcgis-portal.client';
import { PortalCredentialCryptoService } from './portal-credential-crypto.service';
import {
  collectPortalHostKeysFromConfig,
  isPortalHostKeyFormat,
  normalizePortalHostKey,
} from './portal-host-keys';

type CacheEntry = {
  token: string;
  expiresAt: number;
  portalUrl: string;
  portalHostKey: string;
  referer: string;
};

const DEFAULT_EXPIRATION_MINUTES = 60;
/** Refresh when fewer than this many ms remain. */
const CACHE_SKEW_MS = 60_000;

@Injectable()
export class PortalAuthTokenService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PortalCredentialCryptoService,
    private readonly portalClient: ArcgisPortalClient,
    private readonly configService: ConfigService,
  ) {}

  async issueToken(input: {
    appKey: string;
    portalHostKey: string;
    origin: string;
  }): Promise<{
    token: string;
    expiresAt: number;
    referer: string;
    portalUrl: string;
    portalHostKey: string;
  }> {
    const portalHostKey = normalizePortalHostKey(input.portalHostKey);
    if (!isPortalHostKeyFormat(portalHostKey)) {
      throw new ForbiddenException('Portal host is not available');
    }

    const application = await this.prisma.application.findUnique({
      where: { key: input.appKey },
      select: {
        id: true,
        key: true,
        isActive: true,
        config: true,
      },
    });

    if (!application) {
      throw new NotFoundException(
        `Application with key "${input.appKey}" was not found`,
      );
    }

    if (!application.isActive) {
      throw new ForbiddenException('Application is inactive');
    }

    const referencedHosts = collectPortalHostKeysFromConfig(application.config);
    if (!referencedHosts.includes(portalHostKey)) {
      // Do not reveal whether the PortalCredential key exists.
      throw new ForbiddenException('Portal host is not available');
    }

    const credential = await this.prisma.portalCredential.findUnique({
      where: { key: portalHostKey },
      select: {
        id: true,
        key: true,
        portalUrl: true,
        username: true,
        encryptedPassword: true,
        isActive: true,
      },
    });

    if (!credential || !credential.isActive) {
      throw new ForbiddenException('Portal host is not available');
    }

    const referer = input.origin;
    const cacheKey = `${credential.id}::${referer}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt - Date.now() > CACHE_SKEW_MS) {
      return {
        token: cached.token,
        expiresAt: cached.expiresAt,
        referer: cached.referer,
        portalUrl: cached.portalUrl,
        portalHostKey: cached.portalHostKey,
      };
    }

    let password: string;
    try {
      password = this.crypto.decrypt(credential.encryptedPassword);
    } catch {
      throw new ServiceUnavailableException(
        'Portal credential could not be decrypted',
      );
    }

    const expirationMinutes = this.resolveExpirationMinutes();

    try {
      const result = await this.portalClient.generateToken({
        portalUrl: credential.portalUrl,
        username: credential.username,
        password,
        referer,
        expirationMinutes,
      });

      this.cache.set(cacheKey, {
        token: result.token,
        expiresAt: result.expiresAt,
        portalUrl: credential.portalUrl,
        portalHostKey: credential.key,
        referer,
      });

      return {
        token: result.token,
        expiresAt: result.expiresAt,
        referer,
        portalUrl: credential.portalUrl,
        portalHostKey: credential.key,
      };
    } catch (error) {
      if (error instanceof PortalNetworkError) {
        throw new ServiceUnavailableException('Unable to reach ArcGIS Portal');
      }
      if (
        error instanceof PortalAuthError ||
        error instanceof PortalResponseError
      ) {
        throw new UnauthorizedException('Portal authentication failed');
      }
      throw error;
    }
  }

  /** Clear cached tokens for a credential (e.g. after password rotation). */
  invalidateCredential(credentialId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${credentialId}::`)) {
        this.cache.delete(key);
      }
    }
  }

  private resolveExpirationMinutes(): number {
    const raw = this.configService.get<string>(
      'PORTAL_TOKEN_EXPIRATION_MINUTES',
    );
    if (!raw?.trim()) {
      return DEFAULT_EXPIRATION_MINUTES;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1440) {
      return DEFAULT_EXPIRATION_MINUTES;
    }
    return parsed;
  }
}
