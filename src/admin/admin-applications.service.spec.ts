import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationAuditAction, Prisma } from '@prisma/client';
import { AuthenticatedAdmin } from '../auth/auth.constants';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { populationMappingFixture } from '../config/validation/fixtures/harmonized-fixtures';
import { AdminApplicationsService } from './admin-applications.service';

const validConfig = {
  app: { name: 'Test App' },
  organization: { name: 'Org' },
  contact: {},
  footer: {},
  legal: {},
  modules: [],
};

const actor: AuthenticatedAdmin = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'admin@example.com',
  role: 'ADMIN',
};

describe('AdminApplicationsService', () => {
  let service: AdminApplicationsService;
  let prisma: {
    application: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    portalCredential: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let auditService: {
    createInTransaction: jest.Mock;
    fullApplicationSnapshot: jest.Mock;
    metadataSnapshot: jest.Mock;
    classifyMetadataPatch: jest.Mock;
  };
  let tx: {
    application: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    portalCredential: {
      findUnique: jest.Mock;
    };
  };

  const detail = {
    id: '11111111-1111-1111-1111-111111111111',
    key: 'inspection-hub',
    name: 'Inspection Hub',
    isActive: true,
    config: validConfig,
    portalCredentialId: null,
    portalCredential: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  const detailDto = {
    ...detail,
    referencedPortalHosts: [] as Array<{
      key: string;
      name: string | null;
      portalUrl: string | null;
      isActive: boolean;
      profileConfigured: boolean;
      warning: string | null;
    }>,
  };

  beforeEach(async () => {
    tx = {
      application: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      portalCredential: {
        findUnique: jest.fn(),
      },
    };

    prisma = {
      application: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      portalCredential: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    auditService = {
      createInTransaction: jest.fn().mockResolvedValue(undefined),
      fullApplicationSnapshot: jest.fn((app: typeof detail) => ({
        id: app.id,
        key: app.key,
        name: app.name,
        isActive: app.isActive,
        config: app.config,
      })),
      metadataSnapshot: jest.fn((app: { name: string; isActive: boolean }) => ({
        name: app.name,
        isActive: app.isActive,
      })),
      classifyMetadataPatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminApplicationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(AdminApplicationsService);
  });

  it('lists applications ordered by key without config', async () => {
    prisma.application.findMany.mockResolvedValue([
      {
        id: detail.id,
        key: detail.key,
        name: detail.name,
        isActive: true,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      },
    ]);

    const result = await service.listApplications();
    expect(result[0]).not.toHaveProperty('config');
    expect(prisma.application.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        key: true,
        name: true,
        isActive: true,
        portalCredentialId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { key: 'asc' },
    });
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
  });

  it('getApplication does not create audit', async () => {
    prisma.application.findUnique.mockResolvedValue(detail);
    await service.getApplication('inspection-hub');
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates an application and APPLICATION_CREATED audit in one transaction', async () => {
    tx.application.create.mockResolvedValue(detail);

    await expect(
      service.createApplication(
        {
          key: 'inspection-hub',
          name: 'Inspection Hub',
          config: validConfig,
        },
        actor,
      ),
    ).resolves.toEqual(detailDto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.application.create).toHaveBeenCalled();
    expect(auditService.createInTransaction).toHaveBeenCalledTimes(1);
    const auditCalls = auditService.createInTransaction.mock
      .calls as unknown as unknown[][];
    expect(auditCalls[0]?.[0]).toBe(tx);
    const auditPayload = auditCalls[0]?.[1] as {
      applicationId: string;
      applicationKey: string;
      actorId: string;
      actorEmail: string;
      action: ApplicationAuditAction;
      before: null;
      after: Record<string, unknown>;
    };
    expect(auditPayload).toMatchObject({
      applicationId: detail.id,
      applicationKey: detail.key,
      actorId: actor.id,
      actorEmail: actor.email,
      action: ApplicationAuditAction.APPLICATION_CREATED,
      before: null,
    });
    expect(auditPayload.after).toEqual({
      id: detail.id,
      key: detail.key,
      name: detail.name,
      isActive: true,
      config: validConfig,
    });
    expect(auditPayload.after).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(auditPayload)).not.toContain('passwordHash');
  });

  it('maps duplicate key to ConflictException with no committed audit', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    tx.application.create.mockRejectedValue(error);

    await expect(
      service.createApplication(
        {
          key: 'inspection-hub',
          name: 'Inspection Hub',
          config: validConfig,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
  });

  it('creates Population Mapping harmonized config without requiring all Education sections', async () => {
    const created = {
      ...detail,
      key: 'population-mapping',
      name: 'Population Mapping',
      config: populationMappingFixture,
    };
    tx.application.create.mockResolvedValue(created);

    const result = await service.createApplication(
      {
        key: 'population-mapping',
        name: 'Population Mapping',
        config: populationMappingFixture,
      },
      actor,
    );

    expect(result.config).toEqual(populationMappingFixture);
    const createCalls = tx.application.create.mock.calls as Array<
      [{ data: { config: unknown } }]
    >;
    expect(createCalls[0]?.[0].data.config).toEqual(populationMappingFixture);
  });

  it('rejects invalid config on create without transaction', async () => {
    await expect(
      service.createApplication(
        {
          key: 'inspection-hub',
          name: 'Inspection Hub',
          config: { app: [] },
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
  });

  it('name patch → APPLICATION_METADATA_UPDATED', async () => {
    tx.application.findUnique.mockResolvedValue(detail);
    tx.application.update.mockResolvedValue({
      ...detail,
      name: 'Renamed',
    });
    auditService.classifyMetadataPatch.mockReturnValue(
      ApplicationAuditAction.APPLICATION_METADATA_UPDATED,
    );

    await service.updateApplicationMetadata(
      'inspection-hub',
      { name: 'Renamed' },
      actor,
    );

    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.APPLICATION_METADATA_UPDATED,
        before: { name: 'Inspection Hub', isActive: true },
        after: { name: 'Renamed', isActive: true },
        actorId: actor.id,
        actorEmail: actor.email,
      }),
    );
  });

  it('activate → APPLICATION_ACTIVATED', async () => {
    const inactive = { ...detail, isActive: false };
    tx.application.findUnique.mockResolvedValue(inactive);
    tx.application.update.mockResolvedValue({ ...detail, isActive: true });
    auditService.classifyMetadataPatch.mockReturnValue(
      ApplicationAuditAction.APPLICATION_ACTIVATED,
    );

    await service.updateApplicationMetadata(
      'inspection-hub',
      { isActive: true },
      actor,
    );

    expect(auditService.classifyMetadataPatch).toHaveBeenCalledWith({
      nameChanged: false,
      isActiveChanged: true,
      nextIsActive: true,
    });
    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.APPLICATION_ACTIVATED,
      }),
    );
  });

  it('deactivate → APPLICATION_DEACTIVATED', async () => {
    tx.application.findUnique.mockResolvedValue(detail);
    tx.application.update.mockResolvedValue({ ...detail, isActive: false });
    auditService.classifyMetadataPatch.mockReturnValue(
      ApplicationAuditAction.APPLICATION_DEACTIVATED,
    );

    await service.updateApplicationMetadata(
      'inspection-hub',
      { isActive: false },
      actor,
    );

    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.APPLICATION_DEACTIVATED,
        before: { name: 'Inspection Hub', isActive: true },
        after: { name: 'Inspection Hub', isActive: false },
      }),
    );
  });

  it('name + isActive change → one METADATA_UPDATED', async () => {
    tx.application.findUnique.mockResolvedValue(detail);
    tx.application.update.mockResolvedValue({
      ...detail,
      name: 'Renamed',
      isActive: false,
    });
    auditService.classifyMetadataPatch.mockReturnValue(
      ApplicationAuditAction.APPLICATION_METADATA_UPDATED,
    );

    await service.updateApplicationMetadata(
      'inspection-hub',
      { name: 'Renamed', isActive: false },
      actor,
    );

    expect(auditService.createInTransaction).toHaveBeenCalledTimes(1);
    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.APPLICATION_METADATA_UPDATED,
      }),
    );
  });

  it('no-op patch creates no audit', async () => {
    tx.application.findUnique.mockResolvedValue(detail);

    const result = await service.updateApplicationMetadata(
      'inspection-hub',
      { name: 'Inspection Hub', isActive: true },
      actor,
    );

    expect(result).toEqual(detailDto);
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
  });

  it('replaces config with APPLICATION_CONFIG_REPLACED audit', async () => {
    const nextConfig = { ...validConfig, app: { name: 'Next' } };
    tx.application.findUnique.mockResolvedValue(detail);
    tx.application.update.mockResolvedValue({
      ...detail,
      config: nextConfig,
    });

    await service.replaceConfig('inspection-hub', nextConfig, actor);

    expect(auditService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: ApplicationAuditAction.APPLICATION_CONFIG_REPLACED,
        before: validConfig,
        after: nextConfig,
        actorId: actor.id,
        actorEmail: actor.email,
      }),
    );
  });

  it('does not write when replace config is invalid', async () => {
    await expect(
      service.replaceConfig('inspection-hub', { modules: {} }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when updating missing app', async () => {
    tx.application.findUnique.mockResolvedValue(null);

    await expect(
      service.updateApplicationMetadata('missing-app', { name: 'X' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditService.createInTransaction).not.toHaveBeenCalled();
  });

  describe('transaction atomicity', () => {
    it('CREATE: audit insert failure rolls back application mutation', async () => {
      const ops: string[] = [];
      prisma.$transaction.mockImplementation(
        async (callback: (client: typeof tx) => unknown) => {
          try {
            return await callback(tx);
          } catch (error) {
            ops.push('rollback');
            throw error;
          }
        },
      );
      tx.application.create.mockImplementation(() => {
        ops.push('app-create');
        return Promise.resolve(detail);
      });
      auditService.createInTransaction.mockImplementation(() => {
        ops.push('audit-fail');
        return Promise.reject(new Error('audit insert failed'));
      });

      await expect(
        service.createApplication(
          {
            key: 'inspection-hub',
            name: 'Inspection Hub',
            config: validConfig,
          },
          actor,
        ),
      ).rejects.toThrow('audit insert failed');

      expect(ops).toEqual(['app-create', 'audit-fail', 'rollback']);
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('PATCH: audit insert failure rolls back metadata mutation', async () => {
      const ops: string[] = [];
      prisma.$transaction.mockImplementation(
        async (callback: (client: typeof tx) => unknown) => {
          try {
            return await callback(tx);
          } catch (error) {
            ops.push('rollback');
            throw error;
          }
        },
      );
      tx.application.findUnique.mockResolvedValue(detail);
      tx.application.update.mockImplementation(() => {
        ops.push('app-update');
        return Promise.resolve({ ...detail, name: 'Renamed' });
      });
      auditService.classifyMetadataPatch.mockReturnValue(
        ApplicationAuditAction.APPLICATION_METADATA_UPDATED,
      );
      auditService.createInTransaction.mockImplementation(() => {
        ops.push('audit-fail');
        return Promise.reject(new Error('audit insert failed'));
      });

      await expect(
        service.updateApplicationMetadata(
          'inspection-hub',
          { name: 'Renamed' },
          actor,
        ),
      ).rejects.toThrow('audit insert failed');

      expect(ops).toEqual(['app-update', 'audit-fail', 'rollback']);
    });

    it('PUT config: audit insert failure rolls back config replacement', async () => {
      const ops: string[] = [];
      prisma.$transaction.mockImplementation(
        async (callback: (client: typeof tx) => unknown) => {
          try {
            return await callback(tx);
          } catch (error) {
            ops.push('rollback');
            throw error;
          }
        },
      );
      tx.application.findUnique.mockResolvedValue(detail);
      tx.application.update.mockImplementation(() => {
        ops.push('app-update');
        return Promise.resolve(detail);
      });
      auditService.createInTransaction.mockImplementation(() => {
        ops.push('audit-fail');
        return Promise.reject(new Error('audit insert failed'));
      });

      await expect(
        service.replaceConfig('inspection-hub', validConfig, actor),
      ).rejects.toThrow('audit insert failed');

      expect(ops).toEqual(['app-update', 'audit-fail', 'rollback']);
    });

    it('failed application mutation creates no audit', async () => {
      tx.application.findUnique.mockResolvedValue(detail);
      tx.application.update.mockRejectedValue(new Error('db write failed'));

      await expect(
        service.replaceConfig('inspection-hub', validConfig, actor),
      ).rejects.toThrow('db write failed');

      expect(auditService.createInTransaction).not.toHaveBeenCalled();
    });
  });
});
