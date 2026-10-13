import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SHARED_THEME_APP_KEY, withSharedTypography } from './typography';

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfigByAppKey(appKey: string): Promise<Prisma.JsonValue> {
    const application = await this.prisma.application.findFirst({
      where: { key: appKey, isActive: true },
      select: { config: true },
    });

    if (!application) {
      throw new NotFoundException(
        `Application with key "${appKey}" was not found`,
      );
    }

    if (appKey === SHARED_THEME_APP_KEY) {
      return application.config;
    }

    // Shared typography default (active `shared-theme` row); the app's own
    // branding.typography overrides it per role.
    const shared = await this.findSharedThemeConfig();

    return withSharedTypography(application.config, shared) as Prisma.JsonValue;
  }

  /**
   * `branding.typography` of the active `shared-theme` row, or `undefined`
   * when the row or the section is missing. Not validated here.
   */
  async getSharedTypography(): Promise<unknown> {
    const shared = await this.findSharedThemeConfig();
    if (!shared || typeof shared !== 'object' || Array.isArray(shared)) {
      return undefined;
    }
    const branding = shared.branding;
    if (!branding || typeof branding !== 'object' || Array.isArray(branding)) {
      return undefined;
    }
    return branding.typography;
  }

  private async findSharedThemeConfig(): Promise<Prisma.JsonValue | undefined> {
    const shared = await this.prisma.application.findFirst({
      where: { key: SHARED_THEME_APP_KEY, isActive: true },
      select: { config: true },
    });
    return shared?.config;
  }
}
