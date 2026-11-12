/**
 * Smart Inventory System - User Model
 * 
 * Mongoose schema for users with password hashing,
 * role-based access, and business scoping.
 * 
 * Problem solved: Defines the user structure with secure
 * password storage and role-based authorization.
 * 
 * How it works:
 * - password field stores hashed value (never plain text)
 * - bcrypt is used for hashing — never store passwords in plain text
 * - role field determines permissions (admin/staff)
 * - businessId scopes data ownership
 * - methods compare password candidates against hash
 * 
 * Why chosen over alternatives:
 * - bcrypt is the industry standard for password hashing
 * - Includes salt generation and adaptive work factor
 * - Mongoose schema validator ensures password format
 * - Comparer method keeps auth logic close to the data
 */
import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Interface for user document fields.
 * Defines the type shape for TypeScript usage.
 */
interface IUser {
  name: string;
  email: string;
  password: string; // Hashed password
  role: 'admin' | 'staff';
  businessId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Instance methods available on a hydrated user document. */
interface IUserMethods {
  comparePassword(candidatePassword: string): Promise<boolean>;
}

/** Static methods available on the User model. */
interface UserStatics {
  findByEmail(
    email: string,
    includePassword?: boolean
  ): Promise<HydratedDocument<IUser, IUserMethods> | null>;
}

type UserModel = Model<IUser, {}, IUserMethods> & UserStatics;

/**
 * User Schema — defines fields, types, and validators.
 * 
 * Field explanations:
 * - name: User full name (required, trimmed)
 * - email: Login email (required, unique, lowercase, validated)
 * - password: Hashed password (required, min length for bcrypt)
 * - role: User permission level (required, enum: admin | staff)
 * - businessId: Ownership scoping (required)
 */
const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: {
      type: String,
      required: [true, 'User name is required'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      // Excluded from queries unless explicitly requested with select('+password').
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: {
        values: ['admin', 'staff'],
        message: 'Role must be either admin or staff',
      },
      default: 'staff',
    },
    businessId: {
      type: String,
      required: [true, 'Business ID is required'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: any, ret: any) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        // Explicitly exclude password from JSON output
        delete ret.password;
        return ret;
      },
    },
  }
);

// --- Pre-Save Hook: Hash Password Before Saving ---

/**
 * bcrypt salt rounds — higher = more secure but slower.
 * 10 is a common balance for most applications.
 */
const SALT_ROUNDS = 10;

/**
 * Pre-save middleware that hashes the password if it's modified.
 * This runs automatically whenever a user document is saved to the DB.
 * 
 * Important: We check `this.isModified('password')` so we don't
 * re-hash an already-hashed password on every save.
 */
userSchema.pre('save', async function () {
  // Only hash if the password is new or modified (not on every update)
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Method to compare a candidate password with the stored hash.
 * Used during login authentication.
 * 
 * @param candidatePassword - Plain text password from login form
 * @returns true if password matches, false otherwise
 */
userSchema.methods.comparePassword = async function (
  this: IUser,
  candidatePassword: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (err) {
    throw new Error('Password comparison failed');
  }
};

/** --- Static Methods --- */

/**
 * Find a user by email address (case-insensitive due to lowercase: true).
 * The password hash is excluded by default; pass includePassword for login.
 *
 * @param email - User email
 * @param includePassword - Whether to include the password hash
 * @returns User document or null
 */
userSchema.statics.findByEmail = async function (
  email: string,
  includePassword = false
): Promise<HydratedDocument<IUser, IUserMethods> | null> {
  const query = this.findOne({ email: email.toLowerCase() });
  if (includePassword) {
    query.select('+password');
  }
  return query.exec();
};

// Supports admin user listing scoped to one business.
userSchema.index({ businessId: 1, name: 1 });

/** --- Export Model --- */

export type { IUser };

export default model<IUser, UserModel>('User', userSchema);