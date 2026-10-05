import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthTokenService } from './portal-auth-token.service';

describe('PortalAuthController', () => {
  let controller: PortalAuthController;
  let tokenService: { issueToken: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    tokenService = {
      issueToken: jest.fn().mockResolvedValue({
        token: 't',
        expiresAt: 1,
        referer: 'https://localhost:5174',
        portalUrl: 'https://gh.space.gov.rw/portal',
        portalHostKey: 'gh',
      }),
    };
    configService = {
      get: jest
        .fn()
        .mockReturnValue('https://localhost:5174,https://edu.example.com'),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 1000 },
        ]),
      ],
      controllers: [PortalAuthController],
      providers: [
        { provide: PortalAuthTokenService, useValue: tokenService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get(PortalAuthController);
  });

  it('rejects missing Origin', async () => {
    await expect(
      controller.issueToken(
        { appKey: 'education-mapping', portalHostKey: 'gh' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects Origin not in ALLOWED_ORIGINS', async () => {
    await expect(
      controller.issueToken(
        { appKey: 'education-mapping', portalHostKey: 'gh' },
        'https://evil.example.com',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards approved Origin with portalHostKey', async () => {
    await controller.issueToken(
      { appKey: 'education-mapping', portalHostKey: 'gh' },
      'https://localhost:5174',
    );
    expect(tokenService.issueToken).toHaveBeenCalledWith({
      appKey: 'education-mapping',
      portalHostKey: 'gh',
      origin: 'https://localhost:5174',
    });
  });
});
