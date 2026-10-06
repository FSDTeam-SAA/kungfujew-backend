import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'auth_users' })
export class AuthUser extends Document {
  @Prop({ required: true })
  fullName!: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  country?: string;

  @Prop()
  city?: string;

  @Prop()
  postalCode?: number;

  @Prop()
  sector?: string;

  @Prop({ required: true, unique: true })
  email!: string;

  @Prop({ required: true })
  password!: string;

  @Prop({
    enum: [
      'customer',
      'businessowner',
      'admin',
      'story_manager',
      'operations_manager',
    ],
    default: 'customer',
  })
  role!: string;

  @Prop()
  avatar?: string;

  @Prop({ type: Types.ObjectId, ref: 'BusinessInfo', default: null })
  businessId?: Types.ObjectId;

  @Prop({ default: false })
  verified!: boolean;

  @Prop({
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'BLOCKED'],
    default: 'ACTIVE',
  })
  status!: string;

  @Prop({ default: 0 })
  tokenVersion!: number;

  @Prop()
  provider?: string;

  @Prop()
  providerId?: string;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'UserProfile' })
  userProfile?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AuthSecurity' })
  authSecurity?: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'LoginHistory', default: [] })
  loginHistory!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'EmailHistory', default: [] })
  emailHistory!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'ActivityLogEvent', default: [] })
  activityLogEvents!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Subscription', default: [] })
  subscriptions!: Types.ObjectId[];

  @Prop({ default: () => new Date() })
  createdAt!: Date;

  @Prop({ default: () => new Date() })
  updatedAt!: Date;
}

export const AuthUserSchema = SchemaFactory.createForClass(AuthUser);
