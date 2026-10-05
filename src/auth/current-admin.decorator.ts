import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedAdmin } from './auth.constants';

type RequestWithAdmin = Request & { user?: AuthenticatedAdmin };

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAdmin => {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    if (!request.user) {
      throw new Error('CurrentAdmin used without AdminAuthGuard');
    }
    return request.user;
  },
);
