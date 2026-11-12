/**
 * Smart Inventory System - Auth Controller
 *
 * Registration creates a business and its first admin user.
 * Login verifies the password and issues a signed JWT whose claims are the
 * only trusted source of businessId and role for the rest of the API.
 */
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { jwtConfig } from '../config/jwt';
import Business from '../models/businessModel';
import User from '../models/userModel';
import type { AuthenticatedRequest } from '../types/auth';
import { toUserResponse } from '../utils/userResponse';

const successResponse = (
  res: Response,
  data: unknown,
  message: string,
  statusCode: number = 200
): void => {
  res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
};

const errorResponse = (res: Response, message: string, statusCode: number): void => {
  res.status(statusCode).json({
    status: 'error',
    message,
  });
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Maps Mongoose write failures caused by user input to 4xx responses.
 * Returns true when the error was handled.
 */
const handleWriteError = (err: unknown, res: Response): boolean => {
  if (err instanceof Error && err.name === 'ValidationError') {
    const messages = Object.values(
      (err as Error & { errors: Record<string, { message: string }> }).errors
    ).map((fieldError) => fieldError.message);
    errorResponse(res, messages.join(', '), 400);
    return true;
  }

  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    errorResponse(res, 'User with this email already exists', 409);
    return true;
  }

  return false;
};

/**
 * POST /api/auth/register
 *
 * Body: name, email, password, businessName.
 * The caller always becomes the admin of a newly created business;
 * any role or businessId sent in the body is ignored.
 */
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = readString(body.name);
    const email = readString(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const businessName = readString(body.businessName);

    if (!name || !email || !password || !businessName) {
      errorResponse(res, 'Name, email, password and business name are required', 400);
      return;
    }

    if (!EMAIL_PATTERN.test(email)) {
      errorResponse(res, 'Please enter a valid email', 400);
      return;
    }

    if (password.length < 8) {
      errorResponse(res, 'Password must be at least 8 characters', 400);
      return;
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      errorResponse(res, 'User with this email already exists', 409);
      return;
    }

    const business = await Business.create({ name: businessName });

    try {
      const user = await User.create({
        name,
        email,
        password,
        role: 'admin',
        businessId: business.id,
      });

      successResponse(
        res,
        {
          user: toUserResponse(user),
          business: { id: business.id, name: business.name },
        },
        'Business and admin user registered successfully',
        201
      );
    } catch (err) {
      // No transactions on standalone MongoDB: remove the business if the
      // admin user could not be created so no orphan business is left behind.
      await Business.deleteOne({ _id: business._id }).catch(() => undefined);

      if (!handleWriteError(err, res)) {
        next(err);
      }
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 *
 * Body: email, password. Returns a signed JWT and the safe user profile.
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = readString(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      errorResponse(res, 'Email and password are required', 400);
      return;
    }

    const user = await User.findByEmail(email, true);
    if (!user) {
      errorResponse(res, 'Invalid email or password', 401);
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      errorResponse(res, 'Invalid email or password', 401);
      return;
    }

    const token = jwt.sign(
      {
        sub: user.id,
        businessId: user.businessId,
        role: user.role,
      },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    successResponse(
      res,
      {
        token,
        tokenType: 'Bearer',
        expiresIn: jwtConfig.expiresIn,
        user: toUserResponse(user),
      },
      'Login successful'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user and its business, read from the database
 * so profile details never depend on stale token contents.
 */
export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    const user = await User.findById(authUser.id);
    if (!user) {
      errorResponse(res, 'User no longer exists', 401);
      return;
    }

    const business = await Business.findById(user.businessId);

    successResponse(
      res,
      {
        user: toUserResponse(user),
        business: business ? { id: business.id, name: business.name } : null,
      },
      'Current user retrieved'
    );
  } catch (err) {
    next(err);
  }
};
