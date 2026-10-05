import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { adminUser: { findUnique: jest.Mock } };
  let passwordService: { verify: jest.Mock };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { adminUser: { findUnique: jest.fn() } };
    passwordService = { verify: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'JWT_EXPIRES_IN' ? '1h' : undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('returns JWT for valid active credentials', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      passwordHash: 'hash',
      isActive: true,
    });
    passwordService.verify.mockResolvedValue(true);

    const result = await service.login('Admin@Example.com', 'password-long');

    expect(result).toEqual({
      accessToken: 'signed.jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
      },
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('returns generic 401 for nonexistent email', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);

    await expect(
      service.login('missing@example.com', 'password-long'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns generic 401 for wrong password', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      passwordHash: 'hash',
      isActive: true,
    });
    passwordService.verify.mockResolvedValue(false);

    await expect(
      service.login('admin@example.com', 'wrong-password'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns generic 401 for inactive admin', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      passwordHash: 'hash',
      isActive: false,
    });
    passwordService.verify.mockResolvedValue(true);

    await expect(
      service.login('admin@example.com', 'password-long'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
