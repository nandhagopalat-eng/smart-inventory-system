import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { jwtConfig } from '../config/jwt';
import {
  isUserRole,
  type AuthenticatedRequest,
  type UserRole,
} from '../types/auth';

const unauthorized = (res: Response, message: string): void => {
  res.status(401).json({ status: 'error', message });
};

/**
 * Verifies the Bearer token and attaches the caller's user context.
 * businessId always comes from the signed token, never from the request body.
 */
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    unauthorized(res, 'Authentication required');
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    unauthorized(res, 'Authentication required');
    return;
  }

  try {
    const payload = jwt.verify(token, jwtConfig.secret);

    if (
      typeof payload === 'string' ||
      !payload.sub ||
      typeof payload.businessId !== 'string' ||
      !isUserRole(payload.role)
    ) {
      unauthorized(res, 'Invalid token');
      return;
    }

    const scopedRequest = req as AuthenticatedRequest;
    scopedRequest.user = {
      id: String(payload.sub),
      businessId: payload.businessId,
      role: payload.role,
    };
    scopedRequest.businessId = payload.businessId;

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      unauthorized(res, 'Token expired');
      return;
    }
    unauthorized(res, 'Invalid token');
  }
};

/** Allows the request only when the authenticated role is in the allowed list. */
export const authorize =
  (...allowedRoles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      unauthorized(res, 'Authentication required');
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        status: 'error',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
