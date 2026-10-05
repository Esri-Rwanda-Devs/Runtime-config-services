import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplicationAuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAdminEmail } from '../auth/auth.constants';
import { AuditLogItemDto, AuditLogPageDto } from './dto/audit.dto';

export type AuditTransactionClient = Prisma.TransactionClient;

export type ApplicationFullSnapshot = {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
  config: Prisma.JsonValue;
};

export type ApplicationMetadataSnapshot = {
  name: string;
  isActive: boolean;
};

export type CreateAuditLogInput = {
  applicationId: string | null;
  applicationKey: string;
  actorId: string | null;
  actorEmail: string;
  action: ApplicationAuditAction;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
};

export type AuditListFilters = {
  applicationKey?: string;
  action?: ApplicationAuditAction;
  actorEmail?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async createInTransaction(
    tx: AuditTransactionClient,
    input: CreateAuditLogInput,
  ): Promise<void> {
    await tx.applicationAuditLog.create({
      data: {
        applicationId: input.applicationId,
        applicationKey: input.applicationKey,
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        action: input.action,
        before: input.before === null ? Prisma.DbNull : input.before,
        after: input.after === null ? Prisma.DbNull : input.after,
      },
    });
  }

  fullApplicationSnapshot(
    application: ApplicationFullSnapshot,
  ): ApplicationFullSnapshot {
    return {
      id: application.id,
      key: application.key,
      name: application.name,
      isActive: application.isActive,
      config: application.config,
    };
  }

  metadataSnapshot(
    application: Pick<ApplicationFullSnapshot, 'name' | 'isActive'>,
  ): ApplicationMetadataSnapshot {
    return {
      name: application.name,
      isActive: application.isActive,
    };
  }

  classifyMetadataPatch(args: {
    nameChanged: boolean;
    isActiveChanged: boolean;
    nextIsActive?: boolean;
  }): ApplicationAuditAction | null {
    const { nameChanged, isActiveChanged, nextIsActive } = args;
    if (!nameChanged && !isActiveChanged) {
      return null;
    }
    if (isActiveChanged && !nameChanged) {
      return nextIsActive
        ? ApplicationAuditAction.APPLICATION_ACTIVATED
        : ApplicationAuditAction.APPLICATION_DEACTIVATED;
    }
    return ApplicationAuditAction.APPLICATION_METADATA_UPDATED;
  }

  async listAuditLogs(filters: AuditListFilters): Promise<AuditLogPageDto> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = this.buildWhere(filters);

    const [total, rows] = await Promise.all([
      this.prisma.applicationAuditLog.count({ where }),
      this.prisma.applicationAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((row) => this.toItemDto(row)),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private buildWhere(
    filters: AuditListFilters,
  ): Prisma.ApplicationAuditLogWhereInput {
    const where: Prisma.ApplicationAuditLogWhereInput = {};

    if (filters.applicationKey) {
      where.applicationKey = filters.applicationKey;
    }
    if (filters.action) {
      where.action = filters.action;
    }
    if (filters.actorEmail) {
      where.actorEmail = normalizeAdminEmail(filters.actorEmail);
    }

    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom
        ? this.parseInclusiveDate(filters.dateFrom, 'dateFrom')
        : undefined;
      const to = filters.dateTo
        ? this.parseInclusiveDate(filters.dateTo, 'dateTo')
        : undefined;

      if (from && to && from.getTime() > to.getTime()) {
        throw new BadRequestException(
          'dateFrom must be less than or equal to dateTo',
        );
      }

      where.createdAt = {};
      if (from) {
        where.createdAt.gte = from;
      }
      if (to) {
        where.createdAt.lte = to;
      }
    }

    return where;
  }

  private parseInclusiveDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO-8601 date`);
    }
    return date;
  }

  private toItemDto(row: {
    id: string;
    applicationId: string | null;
    applicationKey: string;
    actorId: string | null;
    actorEmail: string;
    action: ApplicationAuditAction;
    before: Prisma.JsonValue | null;
    after: Prisma.JsonValue | null;
    createdAt: Date;
  }): AuditLogItemDto {
    return {
      id: row.id,
      application: {
        id: row.applicationId,
        key: row.applicationKey,
      },
      actor: {
        id: row.actorId,
        email: row.actorEmail,
      },
      action: row.action,
      before: row.before,
      after: row.after,
      createdAt: row.createdAt,
    };
  }
}
