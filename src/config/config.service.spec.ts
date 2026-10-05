import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from './config.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ConfigService', () => {
  let service: ConfigService;
  let prisma: { application: { findFirst: jest.Mock } };

  const sampleConfig = {
    app: { name: 'Education Mapping' },
    organization: { name: 'Rwanda Space Agency' },
  };

  beforeEach(async () => {
    prisma = {
      application: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get(ConfigService);
  });

  it('returns config for an active application', async () => {
    prisma.application.findFirst.mockResolvedValue({ config: sampleConfig });

    await expect(
      service.getConfigByAppKey('education-mapping'),
    ).resolves.toEqual(sampleConfig);

    expect(prisma.application.findFirst).toHaveBeenCalledWith({
      where: { key: 'education-mapping', isActive: true },
      select: { config: true },
    });
  });

  it('throws NotFoundException for an unknown application', async () => {
    prisma.application.findFirst.mockResolvedValue(null);

    await expect(
      service.getConfigByAppKey('missing-app'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException for an inactive application', async () => {
    prisma.application.findFirst.mockResolvedValue(null);

    await expect(
      service.getConfigByAppKey('education-mapping'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.application.findFirst).toHaveBeenCalledWith({
      where: { key: 'education-mapping', isActive: true },
      select: { config: true },
    });
  });

  it('does not expose Application database metadata', async () => {
    prisma.application.findFirst.mockResolvedValue({ config: sampleConfig });

    const result = await service.getConfigByAppKey('education-mapping');

    expect(result).toEqual(sampleConfig);
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('key');
    expect(result).not.toHaveProperty('name');
    expect(result).not.toHaveProperty('isActive');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('may expose portalHostKey but never credentials or tokens', async () => {
    const configWithHost = {
      modules: [
        {
          apps: [
            {
              kind: 'experience',
              portalItemId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              portalHostKey: 'gh',
            },
          ],
        },
      ],
    };
    prisma.application.findFirst.mockResolvedValue({ config: configWithHost });

    const result = (await service.getConfigByAppKey(
      'education-mapping',
    )) as typeof configWithHost;

    expect(result.modules[0].apps[0].portalHostKey).toBe('gh');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /password|encryptedPassword|token|username/i,
    );
    expect(serialized).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
