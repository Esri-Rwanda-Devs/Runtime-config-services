import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminAuthGuard } from './admin-auth.guard';
import { ADMIN_ROLE } from './auth.constants';
import { PrismaService } from '../prisma/prisma.service';

function mockContext(authHeader?: string): ExecutionContext {
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('AdminAuthGuard', () => {
  let guard: AdminAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { adminUser: { findUnique: jest.Mock } };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = { adminUser: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(AdminAuthGuard);
  });

  it('rejects missing token with 401', async () => {
    await expect(guard.canActivate(mockContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects malformed token with 401', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad'));
    await expect(
      guard.canActivate(mockContext('Bearer not-a-jwt')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong role with 403', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      role: 'USER',
    });

    await expect(
      guard.canActivate(mockContext('Bearer token')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects nonexistent admin with 401', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      role: ADMIN_ROLE,
    });
    prisma.adminUser.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(mockContext('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive admin with 403', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      role: ADMIN_ROLE,
    });
    prisma.adminUser.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      isActive: false,
    });

    await expect(
      guard.canActivate(mockContext('Bearer token')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows active admin and attaches req.user without passwordHash', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      role: ADMIN_ROLE,
    });
    prisma.adminUser.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      isActive: true,
    });

    const ctx = mockContext('Bearer token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: Record<string, unknown> }>();
    expect(request.user).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      role: ADMIN_ROLE,
    });
    expect(request.user).not.toHaveProperty('passwordHash');
  });
});
