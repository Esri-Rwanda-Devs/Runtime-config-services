import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ArcgisPortalClient,
  PortalAuthError,
  PortalNetworkError,
} from './arcgis-portal.client';
import { PortalAuthTokenService } from './portal-auth-token.service';
import { PortalCredentialCryptoService } from './portal-credential-crypto.service';

const educationConfig = {
  modules: [
    {
      id: 'public-schools',
      name: 'School Mapping',
      apps: [
        {
          id: 'schools-distribution',
          name: 'Schools',
          kind: 'experience',
          portalItemId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          portalHostKey: 'gh',
        },
        {
          id: 'health-dashboard',
          name: 'Health',
          kind: 'dashboard',
          portalItemId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          portalHostKey: 'rbc',
        },
      ],
    },
  ],
};

describe('PortalAuthTokenService (AUTH-03 host-aware)', () => {
  let service: PortalAuthTokenService;
  let prisma: {
    application: { findUnique: jest.Mock };
    portalCredential: { findUnique: jest.Mock };
  };
  let crypto: { decrypt: jest.Mock };
  let portalClient: { generateToken: jest.Mock };
  let configService: { get: jest.Mock };

  const ghCredential = {
    id: 'cred-gh',
    key: 'gh',
    portalUrl: 'https://gh.space.gov.rw/portal',
    username: 'gh-user',
    encryptedPassword: 'v1:iv:tag:gh-cipher',
    isActive: true,
  };

  const rbcCredential = {
    id: 'cred-rbc',
    key: 'rbc',
    portalUrl: 'https://gis.rbc.gov.rw/portal',
    username: 'rbc-user',
    encryptedPassword: 'v1:iv:tag:rbc-cipher',
    isActive: true,
  };

  const application = {
    id: 'app-1',
    key: 'education-mapping',
    isActive: true,
    config: educationConfig,
  };

  beforeEach(async () => {
    prisma = {
      application: { findUnique: jest.fn() },
      portalCredential: { findUnique: jest.fn() },
    };
    crypto = {
      decrypt: jest.fn((cipher: string) =>
        cipher.includes('rbc') ? 'rbc-password' : 'gh-password',
      ),
    };
    portalClient = {
      generateToken: jest.fn().mockResolvedValue({
        token: 'arcgis-token',
        expiresAt: Date.now() + 3_600_000,
      }),
    };
    configService = {
      get: jest.fn((key: string) =>
        key === 'PORTAL_TOKEN_EXPIRATION_MINUTES' ? '60' : undefined,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalAuthTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: PortalCredentialCryptoService, useValue: crypto },
        { provide: ArcgisPortalClient, useValue: portalClient },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PortalAuthTokenService);
  });

  it('education + gh → GH credential / portalUrl', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(ghCredential);

    const result = await service.issueToken({
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    });

    expect(result.portalHostKey).toBe('gh');
    expect(result.portalUrl).toBe('https://gh.space.gov.rw/portal');
    expect(portalClient.generateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        portalUrl: 'https://gh.space.gov.rw/portal',
        username: 'gh-user',
        password: 'gh-password',
        referer: 'https://localhost:5174',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('gh-password');
    expect(JSON.stringify(result)).not.toContain('username');
  });

  it('education + rbc → RBC credential / portalUrl', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(rbcCredential);

    const result = await service.issueToken({
      appKey: 'education-mapping',
      portalHostKey: 'rbc',
      origin: 'https://localhost:5174',
    });

    expect(result.portalHostKey).toBe('rbc');
    expect(result.portalUrl).toBe('https://gis.rbc.gov.rw/portal');
    expect(portalClient.generateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        portalUrl: 'https://gis.rbc.gov.rw/portal',
        username: 'rbc-user',
        password: 'rbc-password',
      }),
    );
  });

  it('rejects unknown portalHostKey even if credential exists', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue({
      ...ghCredential,
      key: 'wasac',
      id: 'cred-wasac',
    });

    await expect(
      service.issueToken({
        appKey: 'education-mapping',
        portalHostKey: 'wasac',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(portalClient.generateToken).not.toHaveBeenCalled();
  });

  it('rejects configured-but-inactive profile', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue({
      ...ghCredential,
      isActive: false,
    });

    await expect(
      service.issueToken({
        appKey: 'education-mapping',
        portalHostKey: 'gh',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects host-not-used-by-app (no credential lookup leak)', async () => {
    prisma.application.findUnique.mockResolvedValue(application);

    await expect(
      service.issueToken({
        appKey: 'education-mapping',
        portalHostKey: 'reg',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.portalCredential.findUnique).not.toHaveBeenCalled();
  });

  it('rejects unknown app', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    await expect(
      service.issueToken({
        appKey: 'missing',
        portalHostKey: 'gh',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects inactive app', async () => {
    prisma.application.findUnique.mockResolvedValue({
      ...application,
      isActive: false,
    });
    await expect(
      service.issueToken({
        appKey: 'education-mapping',
        portalHostKey: 'gh',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('isolates GH vs RBC credentials and cache', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockImplementation(
      ({ where }: { where: { key: string } }) =>
        Promise.resolve(where.key === 'rbc' ? rbcCredential : ghCredential),
    );

    await service.issueToken({
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    });
    await service.issueToken({
      appKey: 'education-mapping',
      portalHostKey: 'rbc',
      origin: 'https://localhost:5174',
    });

    expect(portalClient.generateToken).toHaveBeenCalledTimes(2);
    const calls = portalClient.generateToken.mock.calls as Array<
      [
        {
          portalUrl: string;
          username: string;
          password: string;
        },
      ]
    >;
    expect(calls[0][0].portalUrl).toBe('https://gh.space.gov.rw/portal');
    expect(calls[0][0].username).toBe('gh-user');
    expect(calls[0][0].password).toBe('gh-password');
    expect(calls[1][0].portalUrl).toBe('https://gis.rbc.gov.rw/portal');
    expect(calls[1][0].username).toBe('rbc-user');
    expect(calls[1][0].password).toBe('rbc-password');

    // Cache hit per credential — third GH call should not re-generate
    await service.issueToken({
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    });
    expect(portalClient.generateToken).toHaveBeenCalledTimes(2);
  });

  it('maps bad Portal credentials to Unauthorized', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(ghCredential);
    portalClient.generateToken.mockRejectedValue(
      new PortalAuthError('Portal authentication failed'),
    );
    await expect(
      service.issueToken({
        appKey: 'education-mapping',
        portalHostKey: 'gh',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps Portal network failure to ServiceUnavailable', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(ghCredential);
    portalClient.generateToken.mockRejectedValue(
      new PortalNetworkError('Unable to reach ArcGIS Portal'),
    );
    await expect(
      service.issueToken({
        appKey: 'education-mapping',
        portalHostKey: 'gh',
        origin: 'https://localhost:5174',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('concurrent requests for one app + host share a single lookup', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(ghCredential);
    const input = {
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    };

    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.issueToken(input)),
    );

    expect(results).toHaveLength(50);
    expect(results.every((r) => r.portalUrl === ghCredential.portalUrl)).toBe(
      true,
    );
    expect(prisma.application.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.portalCredential.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not keep lookups once settled (deactivation applies at once)', async () => {
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(ghCredential);
    const input = {
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    };

    await service.issueToken(input);
    prisma.application.findUnique.mockResolvedValue({
      ...application,
      isActive: false,
    });

    await expect(service.issueToken(input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.application.findUnique).toHaveBeenCalledTimes(2);
  });

  it('a failed shared lookup rejects every waiter and is not reused', async () => {
    prisma.application.findUnique.mockRejectedValueOnce(new Error('pool'));
    prisma.application.findUnique.mockResolvedValue(application);
    prisma.portalCredential.findUnique.mockResolvedValue(ghCredential);
    const input = {
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    };

    const settled = await Promise.allSettled([
      service.issueToken(input),
      service.issueToken(input),
    ]);
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected']);

    await expect(service.issueToken(input)).resolves.toMatchObject({
      portalHostKey: 'gh',
    });
  });
});
