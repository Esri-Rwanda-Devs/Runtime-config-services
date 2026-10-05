import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ROLE,
  AdminJwtPayload,
  AuthenticatedAdmin,
  normalizeAdminEmail,
} from './auth.constants';

type RequestWithAdmin = Request & { user?: AuthenticatedAdmin };

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!payload?.sub || !payload.email || payload.role !== ADMIN_ROLE) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!admin.isActive) {
      throw new ForbiddenException('Administrator account is inactive');
    }

    if (
      normalizeAdminEmail(admin.email) !== normalizeAdminEmail(payload.email)
    ) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = {
      id: admin.id,
      email: admin.email,
      role: ADMIN_ROLE,
    };

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header || typeof header !== 'string') {
      return null;
    }
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }
    return token;
  }
}
