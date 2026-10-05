import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationAuditAction } from '@prisma/client';
import { AuthenticatedAdmin } from '../auth/auth.constants';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ArcgisPortalClient } from './arcgis-portal.client';
import { PortalAuthTokenService } from './portal-auth-token.service';
import { PortalCredentialCryptoService } from './portal-credential-crypto.service';
import {
  PORTAL_CREDENTIAL_AUDIT_KEY,
  PortalCredentialsService,
} from './portal-credentials.service';

const actor: AuthenticatedAdmin = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'admin@example.com',
  role: 'ADMIN',
};

describe('PortalCredentialsService', () => {
  let service: PortalCredentialsService;
  let prisma: {
    portalCredential: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };
  let portalClient: { testCredentials: jest.Mock };
  let auditService: { createInTransaction: jest.Mock };
  let tokenService: { invalidateCredential: jest.Mock };
  let tx: {
    portalCredential: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const row = {
    id: '11111111-1111-1111-1111-111111111111',
    key: 'gh',
    name: 'Rwanda GeoPortal',
    portalUrl: 'https://gh.space.gov.rw/portal',
    username: 'svc-user',
    encryptedPassword: 'v1:iv:tag:cipher',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  beforeEach(async () => {
    tx = {
      portalCredential: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    prisma = {
      portalCredential: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    crypto = {
      encrypt: jest.fn().mockReturnValue('v1:iv:tag:cipher'),
      decrypt: jest.fn().mockReturnValue('plain-password'),
    };
    portalClient = {
      testCredentials: jest.fn().mockResolvedValue({
        success: true,
        message: 'Portal credentials verified.',
      }),
    };
    auditService = {
      createInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = { invalidateCredential: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalCredentialsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PortalCredentialCryptoService, useValue: crypto },
        { provide: ArcgisPortalClient, useValue: portalClient },
        { provide: AuditService, useValue: auditService },
        { provide: PortalAuthTokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get(PortalCredentialsService);
  });

  it('creates a credential with encrypted password and safe response', async () => {
    tx.portalCredential.create.mockResolvedValue(row);

    const result = await service.create(
      {
        key: 'GH',
        name: 'Rwanda GeoPortal',
        portalUrl: 'https://gh.space.gov.rw/portal/',
        username: 'svc-user',
        password: 'plain-password',
      },
      actor,
    );

    expect(crypto.encrypt).toHaveBeenCalledWith('plain-password');
    expect(tx.portalCredential.create).toHaveBeenCalledTimes(1);
    const createCalls = tx.portalCredential.create.mock.calls as Array<
      [
        {
          data: {
            key: string;
            encryptedPassword: string;
            portalUrl: string;
          };
        },
      ]
    >;
    expect(createCalls[0][0].data.key).toBe('gh');
    expect(createCalls[0][0].data.encryptedPassword).toBe('v1:iv:tag:cipher');
    expect(createCalls[0][0].data.portalUrl).toBe(
      'https://gh.space.gov.rw/portal',
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: row.id,
        key: 'gh',
        passwordConfigured: true,
        username: 'svc-user',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('plain-password');
    expect(JSON.stringify(result)).not.toContain('encryptedPassword');
    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.PORTAL_CREDENTIAL_CREATED,
        applicationKey: PORTAL_CREDENTIAL_AUDIT_KEY,
      }),
    );
  });

  it('rotates password and invalidates token cache', async () => {
    tx.portalCredential.findUnique.mockResolvedValue(row);
    tx.portalCredential.update.mockResolvedValue({
      ...row,
      encryptedPassword: 'v1:new:tag:cipher',
    });
    crypto.encrypt.mockReturnValue('v1:new:tag:cipher');

    const result = await service.rotatePassword(row.id, 'new-password', actor);

    expect(crypto.encrypt).toHaveBeenCalledWith('new-password');
    expect(tokenService.invalidateCredential).toHaveBeenCalledWith(row.id);
    expect(result.passwordConfigured).toBe(true);
    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.PORTAL_CREDENTIAL_PASSWORD_ROTATED,
      }),
    );
    const auditCalls = auditService.createInTransaction.mock.calls as Array<
      [unknown, { before: unknown; after: unknown }]
    >;
    const auditArg = auditCalls[0][1];
    expect(JSON.stringify(auditArg)).not.toContain('new-password');
    expect(JSON.stringify(auditArg)).not.toContain('encryptedPassword');
  });

  it('updates metadata and reports passwordConfigured', async () => {
    tx.portalCredential.findUnique.mockResolvedValue(row);
    tx.portalCredential.update.mockResolvedValue({
      ...row,
      name: 'GeoPortal RW',
    });

    const result = await service.update(
      row.id,
      { name: 'GeoPortal RW' },
      actor,
    );
    expect(result.name).toBe('GeoPortal RW');
    expect(result.passwordConfigured).toBe(true);
  });

  it('tests stored credentials without returning tokens', async () => {
    prisma.portalCredential.findUnique.mockResolvedValue(row);
    const result = await service.testStored(row.id, 'https://localhost:5173');
    expect(crypto.decrypt).toHaveBeenCalled();
    expect(portalClient.testCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'plain-password',
        referer: 'https://localhost:5173',
      }),
    );
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('token');
    expect(JSON.stringify(result)).not.toContain('plain-password');
  });

  it('tests inline credentials without storing', async () => {
    const result = await service.testInline(
      {
        portalUrl: 'https://gh.space.gov.rw/portal',
        username: 'svc-user',
        password: 'candidate',
      },
      'https://localhost:5173',
    );
    expect(result.success).toBe(true);
    expect(tx.portalCredential.create).not.toHaveBeenCalled();
  });

  it('returns not found for missing credential', async () => {
    prisma.portalCredential.findUnique.mockResolvedValue(null);
    await expect(service.getById(row.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects empty metadata patch', async () => {
    await expect(service.update(row.id, {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects invalid portal host key format', async () => {
    await expect(
      service.create(
        {
          key: 'Bad Key!',
          name: 'Bad',
          portalUrl: 'https://gh.space.gov.rw/portal',
          username: 'u',
          password: 'p',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.portalCredential.create).not.toHaveBeenCalled();
  });

  it('maps portal auth failure safely', async () => {
    prisma.portalCredential.findUnique.mockResolvedValue(row);
    portalClient.testCredentials.mockResolvedValue({
      success: false,
      message: 'Portal authentication failed.',
    });
    const result = await service.testStored(row.id, 'https://localhost:5173');
    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/password|token|stack/i);
  });
});
