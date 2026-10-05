import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationAuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: {
    applicationAuditLog: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      applicationAuditLog: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  describe('createInTransaction', () => {
    it('inserts via the provided transaction client', async () => {
      const tx = {
        applicationAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'a' }),
        },
      };

      await service.createInTransaction(tx as never, {
        applicationId: 'app-id',
        applicationKey: 'inspection-hub',
        actorId: 'actor-id',
        actorEmail: 'admin@example.com',
        action: ApplicationAuditAction.APPLICATION_CREATED,
        before: null,
        after: { key: 'inspection-hub' },
      });

      expect(tx.applicationAuditLog.create).toHaveBeenCalledTimes(1);
      const createCalls = tx.applicationAuditLog.create.mock
        .calls as unknown as unknown[][];
      const createArg = createCalls[0]?.[0] as {
        data: {
          applicationId: string;
          applicationKey: string;
          actorId: string;
          actorEmail: string;
          action: ApplicationAuditAction;
          before: typeof Prisma.DbNull;
          after: { key: string };
        };
      };
      expect(createArg.data).toEqual({
        applicationId: 'app-id',
        applicationKey: 'inspection-hub',
        actorId: 'actor-id',
        actorEmail: 'admin@example.com',
        action: ApplicationAuditAction.APPLICATION_CREATED,
        before: Prisma.DbNull,
        after: { key: 'inspection-hub' },
      });
      expect(prisma.applicationAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('classifyMetadataPatch', () => {
    it('returns ACTIVATED when only isActive flips true', () => {
      expect(
        service.classifyMetadataPatch({
          nameChanged: false,
          isActiveChanged: true,
          nextIsActive: true,
        }),
      ).toBe(ApplicationAuditAction.APPLICATION_ACTIVATED);
    });

    it('returns DEACTIVATED when only isActive flips false', () => {
      expect(
        service.classifyMetadataPatch({
          nameChanged: false,
          isActiveChanged: true,
          nextIsActive: false,
        }),
      ).toBe(ApplicationAuditAction.APPLICATION_DEACTIVATED);
    });

    it('returns METADATA_UPDATED for name-only or combined changes', () => {
      expect(
        service.classifyMetadataPatch({
          nameChanged: true,
          isActiveChanged: false,
        }),
      ).toBe(ApplicationAuditAction.APPLICATION_METADATA_UPDATED);

      expect(
        service.classifyMetadataPatch({
          nameChanged: true,
          isActiveChanged: true,
          nextIsActive: false,
        }),
      ).toBe(ApplicationAuditAction.APPLICATION_METADATA_UPDATED);
    });

    it('returns null when nothing changed', () => {
      expect(
        service.classifyMetadataPatch({
          nameChanged: false,
          isActiveChanged: false,
        }),
      ).toBeNull();
    });
  });

  describe('listAuditLogs', () => {
    it('maps snapshot fields and paginates newest first', async () => {
      prisma.applicationAuditLog.count.mockResolvedValue(1);
      prisma.applicationAuditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          applicationId: 'app-1',
          applicationKey: 'education-mapping',
          actorId: 'admin-1',
          actorEmail: 'admin@example.com',
          action: ApplicationAuditAction.APPLICATION_CONFIG_REPLACED,
          before: { app: { name: 'Old' } },
          after: { app: { name: 'New' } },
          createdAt: new Date('2026-09-16T12:00:00.000Z'),
        },
      ]);

      const page = await service.listAuditLogs({ page: 1, limit: 20 });

      expect(page).toEqual({
        items: [
          {
            id: 'log-1',
            application: { id: 'app-1', key: 'education-mapping' },
            actor: { id: 'admin-1', email: 'admin@example.com' },
            action: ApplicationAuditAction.APPLICATION_CONFIG_REPLACED,
            before: { app: { name: 'Old' } },
            after: { app: { name: 'New' } },
            createdAt: new Date('2026-09-16T12:00:00.000Z'),
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(prisma.applicationAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(JSON.stringify(page)).not.toContain('passwordHash');
    });

    it('rejects dateFrom after dateTo', async () => {
      await expect(
        service.listAuditLogs({
          dateFrom: '2026-09-02T00:00:00.000Z',
          dateTo: '2026-09-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('normalizes actorEmail filter', async () => {
      prisma.applicationAuditLog.count.mockResolvedValue(0);
      prisma.applicationAuditLog.findMany.mockResolvedValue([]);

      await service.listAuditLogs({
        actorEmail: '  Admin@Example.com ',
      });

      expect(prisma.applicationAuditLog.count).toHaveBeenCalledWith({
        where: { actorEmail: 'admin@example.com' },
      });
    });
  });
});
