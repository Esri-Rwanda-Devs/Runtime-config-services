import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

    return application.config;
  }
}
