import type { UserRole } from '../types/auth';

/** Shape shared by every user returned from the API. */
export interface UserResponseSource {
  id?: string;
  _id?: unknown;
  name: string;
  email: string;
  role: UserRole;
  businessId: string;
}

export const toUserResponse = (user: UserResponseSource) => ({
  id: user.id ?? String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  businessId: user.businessId,
});
