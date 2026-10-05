import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationAuditAction, Prisma } from '@prisma/client';
import { AuthenticatedAdmin } from '../auth/auth.constants';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateRuntimeConfigDocument } from '../config/validation/runtime-config.validator';
import { collectPortalHostKeysFromConfig } from '../portal/portal-host-keys';
import {
  ApplicationDetailDto,
  ApplicationListItemDto,
  ReferencedPortalHostDto,
} from './dto/application.dto';

const PORTAL_CREDENTIAL_SUMMARY_SELECT = {
  id: true,
  key: true,
  name: true,
  portalUrl: true,
  username: true,
  encryptedPassword: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const APPLICATION_DETAIL_SELECT = {
  id: true,
  key: true,
  name: true,
  isActive: true,
  config: true,
  portalCredentialId: true,
  createdAt: true,
  updatedAt: true,
  portalCredential: {
    select: PORTAL_CREDENTIAL_SUMMARY_SELECT,
  },
} as const;

const APPLICATION_LIST_SELECT = {
  id: true,
  key: true,
  name: true,
  isActive: true,
  portalCredentialId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AdminApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listApplications(): Promise<ApplicationListItemDto[]> {
    return this.prisma.application.findMany({
      select: APPLICATION_LIST_SELECT,
      orderBy: { key: 'asc' },
    });
  }

  async getApplication(appKey: string): Promise<ApplicationDetailDto> {
    const application = await this.prisma.application.findUnique({
      where: { key: appKey },
      select: APPLICATION_DETAIL_SELECT,
    });

    if (!application) {
      throw new NotFoundException(
        `Application with key "${appKey}" was not found`,
      );
    }

    return this.toDetailDto(application);
  }

  async createApplication(
    input: {
      key: string;
      name: string;
      config: unknown;
      isActive?: boolean;
    },
    actor: AuthenticatedAdmin,
  ): Promise<ApplicationDetailDto> {
    this.assertValidConfig(input.config);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.application.create({
          data: {
            key: input.key,
            name: input.name,
            config: input.config as Prisma.InputJsonValue,
            isActive: input.isActive ?? true,
          },
          select: APPLICATION_DETAIL_SELECT,
        });

        await this.auditService.createInTransaction(tx, {
          applicationId: created.id,
          applicationKey: created.key,
          actorId: actor.id,
          actorEmail: actor.email,
          action: ApplicationAuditAction.APPLICATION_CREATED,
          before: null,
          after: this.auditService.fullApplicationSnapshot(created),
        });

        return await this.toDetailDto(created);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Application with key "${input.key}" already exists`,
        );
      }
      throw error;
    }
  }

  async updateApplicationMetadata(
    appKey: string,
    input: {
      name?: string;
      isActive?: boolean;
      portalCredentialId?: string | null;
    },
    actor: AuthenticatedAdmin,
  ): Promise<ApplicationDetailDto> {
    if (
      input.name === undefined &&
      input.isActive === undefined &&
      input.portalCredentialId === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, isActive, or portalCredentialId must be provided',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.application.findUnique({
        where: { key: appKey },
        select: APPLICATION_DETAIL_SELECT,
      });

      if (!existing) {
        throw new NotFoundException(
          `Application with key "${appKey}" was not found`,
        );
      }

      const nameChanged =
        input.name !== undefined && input.name !== existing.name;
      const isActiveChanged =
        input.isActive !== undefined && input.isActive !== existing.isActive;
      const portalAssignmentChanged =
        input.portalCredentialId !== undefined &&
        input.portalCredentialId !== existing.portalCredentialId;

      if (!nameChanged && !isActiveChanged && !portalAssignmentChanged) {
        return await this.toDetailDto(existing);
      }

      if (portalAssignmentChanged && input.portalCredentialId !== null) {
        const credential = await tx.portalCredential.findUnique({
          where: { id: input.portalCredentialId },
          select: { id: true, isActive: true, name: true },
        });
        if (!credential) {
          throw new BadRequestException(
            `Portal credential "${input.portalCredentialId}" was not found`,
          );
        }
        if (!credential.isActive) {
          throw new BadRequestException(
            'Cannot assign an inactive Portal credential',
          );
        }
      }

      const data: Prisma.ApplicationUpdateInput = {};
      if (nameChanged) data.name = input.name;
      if (isActiveChanged) data.isActive = input.isActive;
      if (portalAssignmentChanged) {
        data.portalCredential =
          input.portalCredentialId === null
            ? { disconnect: true }
            : { connect: { id: input.portalCredentialId! } };
      }

      const beforeMeta = this.auditService.metadataSnapshot(existing);
      const updated = await tx.application.update({
        where: { key: appKey },
        data,
        select: APPLICATION_DETAIL_SELECT,
      });

      if (nameChanged || isActiveChanged) {
        const action = this.auditService.classifyMetadataPatch({
          nameChanged,
          isActiveChanged,
          nextIsActive: updated.isActive,
        });

        if (action) {
          await this.auditService.createInTransaction(tx, {
            applicationId: updated.id,
            applicationKey: updated.key,
            actorId: actor.id,
            actorEmail: actor.email,
            action,
            before: beforeMeta,
            after: this.auditService.metadataSnapshot(updated),
          });
        }
      }

      if (portalAssignmentChanged) {
        await this.auditService.createInTransaction(tx, {
          applicationId: updated.id,
          applicationKey: updated.key,
          actorId: actor.id,
          actorEmail: actor.email,
          action: ApplicationAuditAction.APPLICATION_PORTAL_CREDENTIAL_ASSIGNED,
          before: {
            portalCredentialId: existing.portalCredentialId,
            portalCredentialName: existing.portalCredential?.name ?? null,
          },
          after: {
            portalCredentialId: updated.portalCredentialId,
            portalCredentialName: updated.portalCredential?.name ?? null,
          },
        });
      }

      return await this.toDetailDto(updated);
    });
  }

  async replaceConfig(
    appKey: string,
    config: unknown,
    actor: AuthenticatedAdmin,
  ): Promise<ApplicationDetailDto> {
    this.assertValidConfig(config);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.application.findUnique({
        where: { key: appKey },
        select: APPLICATION_DETAIL_SELECT,
      });

      if (!existing) {
        throw new NotFoundException(
          `Application with key "${appKey}" was not found`,
        );
      }

      const updated = await tx.application.update({
        where: { key: appKey },
        data: { config: config as Prisma.InputJsonValue },
        select: APPLICATION_DETAIL_SELECT,
      });

      await this.auditService.createInTransaction(tx, {
        applicationId: updated.id,
        applicationKey: updated.key,
        actorId: actor.id,
        actorEmail: actor.email,
        action: ApplicationAuditAction.APPLICATION_CONFIG_REPLACED,
        before: existing.config,
        after: updated.config,
      });

      return await this.toDetailDto(updated);
    });
  }

  private async toDetailDto(application: {
    id: string;
    key: string;
    name: string;
    isActive: boolean;
    config: Prisma.JsonValue;
    portalCredentialId: string | null;
    createdAt: Date;
    updatedAt: Date;
    portalCredential: {
      id: string;
      key: string;
      name: string;
      portalUrl: string;
      username: string;
      encryptedPassword: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }): Promise<ApplicationDetailDto> {
    const referencedPortalHosts = await this.resolveReferencedPortalHosts(
      application.config,
    );

    return {
      id: application.id,
      key: application.key,
      name: application.name,
      isActive: application.isActive,
      config: application.config,
      portalCredentialId: application.portalCredentialId,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      portalCredential: application.portalCredential
        ? {
            id: application.portalCredential.id,
            key: application.portalCredential.key,
            name: application.portalCredential.name,
            portalUrl: application.portalCredential.portalUrl,
            username: application.portalCredential.username,
            isActive: application.portalCredential.isActive,
            passwordConfigured: Boolean(
              application.portalCredential.encryptedPassword,
            ),
            createdAt: application.portalCredential.createdAt,
            updatedAt: application.portalCredential.updatedAt,
          }
        : null,
      referencedPortalHosts,
    };
  }

  private async resolveReferencedPortalHosts(
    config: Prisma.JsonValue,
  ): Promise<ReferencedPortalHostDto[]> {
    const keys = collectPortalHostKeysFromConfig(config);
    if (keys.length === 0) {
      return [];
    }

    const profiles = await this.prisma.portalCredential.findMany({
      where: { key: { in: keys } },
      select: {
        key: true,
        name: true,
        portalUrl: true,
        isActive: true,
      },
    });
    const byKey = new Map(profiles.map((p) => [p.key, p]));

    return keys.map((key) => {
      const profile = byKey.get(key);
      if (!profile) {
        return {
          key,
          name: null,
          portalUrl: null,
          isActive: false,
          profileConfigured: false,
          warning: `Portal authentication is not configured for key "${key}".`,
        };
      }
      return {
        key: profile.key,
        name: profile.name,
        portalUrl: profile.portalUrl,
        isActive: profile.isActive,
        profileConfigured: true,
        warning: profile.isActive
          ? null
          : `Portal profile "${key}" exists but is inactive.`,
      };
    });
  }

  private assertValidConfig(config: unknown): void {
    const result = validateRuntimeConfigDocument(config);
    if (!result.valid) {
      throw new BadRequestException(result.error);
    }
  }
}
