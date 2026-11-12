import { Schema, model } from 'mongoose';

/**
 * Business is the ownership root for every scoped record.
 * Users point at a business; inventory, sales, alerts, and predictions
 * are filtered by the businessId taken from the authenticated token.
 */
interface IBusiness {
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const businessSchema = new Schema<IBusiness>(
  {
    name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
      maxlength: [100, 'Business name cannot exceed 100 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: any, ret: any) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export type { IBusiness };

export default model<IBusiness>('Business', businessSchema);
