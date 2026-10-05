import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ROLE,
  AdminJwtPayload,
  normalizeAdminEmail,
} from './auth.constants';
import { PasswordService } from './password.service';
import { LoginResponseDto } from './dto/login.dto';

const GENERIC_INVALID = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const normalized = normalizeAdminEmail(email);
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: normalized },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
      },
    });

    // Constant-ish failure path: always verify when possible; generic 401 otherwise.
    if (!admin || !admin.isActive) {
      if (admin?.passwordHash) {
        await this.passwordService
          .verify(admin.passwordHash, password)
          .catch(() => false);
      }
      throw new UnauthorizedException(GENERIC_INVALID);
    }

    const valid = await this.passwordService.verify(
      admin.passwordHash,
      password,
    );
    if (!valid) {
      throw new UnauthorizedException(GENERIC_INVALID);
    }

    const expiresIn = this.resolveExpiresInSeconds();
    const payload: AdminJwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: ADMIN_ROLE,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  private resolveExpiresInSeconds(): number {
    const raw = this.configService.get<string>('JWT_EXPIRES_IN') ?? '1h';
    return parseExpiresInToSeconds(raw);
  }
}

export function parseExpiresInToSeconds(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d+)([smhd])$/i.exec(trimmed);
  if (!match) {
    return 3600;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      return 3600;
  }
}
