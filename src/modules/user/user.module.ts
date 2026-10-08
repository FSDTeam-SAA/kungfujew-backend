import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { DatabaseModule } from '../../database/database.module';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import {
  AuthUser,
  AuthUserSchema,
  UserProfile,
  UserProfileSchema,
  ActivityLogEvent,
  ActivityLogEventSchema,
  AuthSecurity,
  AuthSecuritySchema,
} from '../../database/schemas';

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: AuthUser.name, schema: AuthUserSchema },
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: ActivityLogEvent.name, schema: ActivityLogEventSchema },
      { name: AuthSecurity.name, schema: AuthSecuritySchema },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
