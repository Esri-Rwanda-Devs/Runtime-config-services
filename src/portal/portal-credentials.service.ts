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
import { ArcgisPortalClient, normalizePortalUrl } from './arcgis-portal.client';
import { PortalAuthTokenService } from './portal-auth-token.service';
import { PortalCredentialCryptoService } from './portal-credential-crypto.service';
import { PortalCredentialSummaryDto } from './dto/portal-credential.dto';
import {
  isPortalHostKeyFormat,
  normalizePortalHostKey,
} from './portal-host-keys';

/** System audit key for credential lifecycle events not tied to one app. */
export const PORTAL_CREDENTIAL_AUDIT_KEY = '__portal-credentials__';

const CREDENTIAL_SELECT = {
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

@Injectable()
export class PortalCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PortalCredentialCryptoService,
    private readonly portalClient: ArcgisPortalClient,
    private readonly auditService: AuditService,
    private readonly portalAuthTokenService: PortalAuthTokenService,
  ) {}

  async list(): Promise<PortalCredentialSummaryDto[]> {
    const rows = await this.prisma.portalCredential.findMany({
      select: CREDENTIAL_SELECT,
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async getById(id: string): Promise<PortalCredentialSummaryDto> {
    const row = await this.prisma.portalCredential.findUnique({
      where: { id },
      select: CREDENTIAL_SELECT,
    });
    if (!row) {
      throw new NotFoundException(`Portal credential "${id}" was not found`);
    }
    return this.toSummary(row);
  }

  async create(
    input: {
      key: string;
      name: string;
      portalUrl: string;
      username: string;
      password: string;
      isActive?: boolean;
    },
    actor: AuthenticatedAdmin,
  ): Promise<PortalCredentialSummaryDto> {
    const key = normalizePortalHostKey(input.key);
    if (!isPortalHostKeyFormat(key)) {
      throw new BadRequestException(
        'key must be a lowercase kebab-case identifier (e.g. gh, rbc)',
      );
    }

    let portalUrl: string;
    try {
      portalUrl = normalizePortalUrl(input.portalUrl);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid portalUrl',
      );
    }

    const encryptedPassword = this.crypto.encrypt(input.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.portalCredential.create({
          data: {
            key,
            name: input.name,
            portalUrl,
            username: input.username,
            encryptedPassword,
            isActive: input.isActive ?? true,
          },
          select: CREDENTIAL_SELECT,
        });

        await this.auditService.createInTransaction(tx, {
          applicationId: null,
          applicationKey: PORTAL_CREDENTIAL_AUDIT_KEY,
          actorId: actor.id,
          actorEmail: actor.email,
          action: ApplicationAuditAction.PORTAL_CREDENTIAL_CREATED,
          before: null,
          after: this.auditSnapshot(created),
        });

        return this.toSummary(created);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Portal credential key "${key}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: {
      name?: string;
      portalUrl?: string;
      username?: string;
      isActive?: boolean;
    },
    actor: AuthenticatedAdmin,
  ): Promise<PortalCredentialSummaryDto> {
    if (
      input.name === undefined &&
      input.portalUrl === undefined &&
      input.username === undefined &&
      input.isActive === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, portalUrl, username, or isActive must be provided',
      );
    }

    let portalUrl: string | undefined;
    if (input.portalUrl !== undefined) {
      try {
        portalUrl = normalizePortalUrl(input.portalUrl);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid portalUrl',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.portalCredential.findUnique({
        where: { id },
        select: CREDENTIAL_SELECT,
      });
      if (!existing) {
        throw new NotFoundException(`Portal credential "${id}" was not found`);
      }

      const nameChanged =
        input.name !== undefined && input.name !== existing.name;
      const portalUrlChanged =
        portalUrl !== undefined && portalUrl !== existing.portalUrl;
      const usernameChanged =
        input.username !== undefined && input.username !== existing.username;
      const isActiveChanged =
        input.isActive !== undefined && input.isActive !== existing.isActive;

      if (
        !nameChanged &&
        !portalUrlChanged &&
        !usernameChanged &&
        !isActiveChanged
      ) {
        return this.toSummary(existing);
      }

      const data: Prisma.PortalCredentialUpdateInput = {};
      if (nameChanged) data.name = input.name;
      if (portalUrlChanged) data.portalUrl = portalUrl;
      if (usernameChanged) data.username = input.username;
      if (isActiveChanged) data.isActive = input.isActive;

      const updated = await tx.portalCredential.update({
        where: { id },
        data,
        select: CREDENTIAL_SELECT,
      });

      let action: ApplicationAuditAction =
        ApplicationAuditAction.PORTAL_CREDENTIAL_UPDATED;
      if (
        isActiveChanged &&
        !nameChanged &&
        !portalUrlChanged &&
        !usernameChanged
      ) {
        action = updated.isActive
          ? ApplicationAuditAction.PORTAL_CREDENTIAL_ACTIVATED
          : ApplicationAuditAction.PORTAL_CREDENTIAL_DEACTIVATED;
      }

      await this.auditService.createInTransaction(tx, {
        applicationId: null,
        applicationKey: PORTAL_CREDENTIAL_AUDIT_KEY,
        actorId: actor.id,
        actorEmail: actor.email,
        action,
        before: this.auditSnapshot(existing),
        after: this.auditSnapshot(updated),
      });

      return this.toSummary(updated);
    });
  }

  async rotatePassword(
    id: string,
    password: string,
    actor: AuthenticatedAdmin,
  ): Promise<PortalCredentialSummaryDto> {
    const encryptedPassword = this.crypto.encrypt(password);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.portalCredential.findUnique({
        where: { id },
        select: CREDENTIAL_SELECT,
      });
      if (!existing) {
        throw new NotFoundException(`Portal credential "${id}" was not found`);
      }

      const updated = await tx.portalCredential.update({
        where: { id },
        data: { encryptedPassword },
        select: CREDENTIAL_SELECT,
      });

      await this.auditService.createInTransaction(tx, {
        applicationId: null,
        applicationKey: PORTAL_CREDENTIAL_AUDIT_KEY,
        actorId: actor.id,
        actorEmail: actor.email,
        action: ApplicationAuditAction.PORTAL_CREDENTIAL_PASSWORD_ROTATED,
        before: {
          id: existing.id,
          key: existing.key,
          name: existing.name,
          passwordRotated: false,
        },
        after: {
          id: updated.id,
          key: updated.key,
          name: updated.name,
          passwordRotated: true,
        },
      });

      this.portalAuthTokenService.invalidateCredential(id);
      return this.toSummary(updated);
    });
  }

  async testStored(
    id: string,
    referer: string,
  ): Promise<{ success: boolean; message: string }> {
    const row = await this.prisma.portalCredential.findUnique({
      where: { id },
      select: CREDENTIAL_SELECT,
    });
    if (!row) {
      throw new NotFoundException(`Portal credential "${id}" was not found`);
    }

    let password: string;
    try {
      password = this.crypto.decrypt(row.encryptedPassword);
    } catch {
      return {
        success: false,
        message: 'Stored credentials could not be decrypted.',
      };
    }

    return this.portalClient.testCredentials({
      portalUrl: row.portalUrl,
      username: row.username,
      password,
      referer,
    });
  }

  async testInline(
    input: {
      portalUrl: string;
      username: string;
      password: string;
    },
    referer: string,
  ): Promise<{ success: boolean; message: string }> {
    let portalUrl: string;
    try {
      portalUrl = normalizePortalUrl(input.portalUrl);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid portalUrl',
      );
    }

    return this.portalClient.testCredentials({
      portalUrl,
      username: input.username,
      password: input.password,
      referer,
    });
  }

  private toSummary(row: {
    id: string;
    key: string;
    name: string;
    portalUrl: string;
    username: string;
    encryptedPassword: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): PortalCredentialSummaryDto {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      portalUrl: row.portalUrl,
      username: row.username,
      isActive: row.isActive,
      passwordConfigured: Boolean(row.encryptedPassword),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private auditSnapshot(row: {
    id: string;
    key: string;
    name: string;
    portalUrl: string;
    username: string;
    isActive: boolean;
  }): Prisma.InputJsonValue {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      portalUrl: row.portalUrl,
      username: row.username,
      isActive: row.isActive,
      passwordConfigured: true,
    };
  }
}
