/**
 * Smart Inventory System - User Controller
 *
 * Admin-only user management inside the authenticated business.
 * businessId always comes from the token; role values are allowlisted.
 */
import type { NextFunction, Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';

import User from '../models/userModel';
import { isUserRole, type AuthenticatedRequest } from '../types/auth';
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

const requireBusinessId = (req: Request, res: Response): string | null => {
  const businessId = (req as AuthenticatedRequest).businessId;
  if (!businessId) {
    errorResponse(res, 'Authentication required', 401);
    return null;
  }
  return businessId;
};

/**
 * GET /api/users
 * Admin only. Lists users belonging to the caller's business.
 */
export const listUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = requireBusinessId(req, res);
    if (!businessId) {
      return;
    }

    const users = await User.find({ businessId }).sort({ name: 1 }).exec();

    successResponse(
      res,
      { items: users.map(toUserResponse), total: users.length },
      'Users retrieved'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/users
 * Admin only. Creates a user in the caller's business.
 * Body: name, email, password, role (admin | staff, default staff).
 */
export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = requireBusinessId(req, res);
    if (!businessId) {
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = readString(body.name);
    const email = readString(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role ?? 'staff';

    if (!name || !email || !password) {
      errorResponse(res, 'Name, email and password are required', 400);
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

    if (!isUserRole(role)) {
      errorResponse(res, 'Role must be either admin or staff', 400);
      return;
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      errorResponse(res, 'User with this email already exists', 409);
      return;
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      businessId,
    });

    successResponse(res, { user: toUserResponse(user) }, 'User created successfully', 201);
  } catch (err) {
    if (!handleWriteError(err, res)) {
      next(err);
    }
  }
};

/**
 * PATCH /api/users/:id/role
 * Admin only. Changes a role inside the caller's business.
 * An admin cannot change their own role, so the last admin cannot be demoted
 * by accident and a role claim can never be self-escalated.
 */
export const updateUserRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = requireBusinessId(req, res);
    if (!businessId) {
      return;
    }

    const { id } = req.params;
    const role = (req.body ?? {}).role;

    if (!id || !isValidObjectId(id)) {
      errorResponse(res, 'Invalid user ID', 400);
      return;
    }

    if (!isUserRole(role)) {
      errorResponse(res, 'Role must be either admin or staff', 400);
      return;
    }

    const authUser = (req as AuthenticatedRequest).user;
    if (authUser && authUser.id === id) {
      errorResponse(res, 'You cannot change your own role', 400);
      return;
    }

    const user = await User.findOneAndUpdate(
      { _id: id, businessId },
      { role },
      { returnDocument: 'after', runValidators: true }
    ).exec();

    if (!user) {
      errorResponse(res, 'User not found', 404);
      return;
    }

    successResponse(res, { user: toUserResponse(user) }, 'User role updated');
  } catch (err) {
    if (!handleWriteError(err, res)) {
      next(err);
    }
  }
};
