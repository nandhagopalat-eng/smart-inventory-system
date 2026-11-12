import type { Request } from 'express';

export type UserRole = 'admin' | 'staff';

export interface AuthUser {
  id: string;
  businessId: string;
  role: UserRole;
}

/**
 * Request after the authenticate middleware has attached the token context.
 * businessId is duplicated here because controllers already read it.
 */
export type AuthenticatedRequest = Request & {
  user?: AuthUser;
  businessId?: string;
};

export const isUserRole = (value: unknown): value is UserRole =>
  value === 'admin' || value === 'staff';
