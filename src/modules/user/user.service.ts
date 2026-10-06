import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CustomLoggerService } from '../../common/services/custom-logger.service';
import { AuthUser, AuthSecurity } from '../../database/schemas';
import { CloudinaryService } from '../../common/services/cloudinary.service';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(AuthUser.name) private readonly userModel: Model<AuthUser>,
    @InjectModel(AuthSecurity.name)
    private readonly authSecurityModel: Model<AuthSecurity>,
    private readonly customLogger: CustomLoggerService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async findAll() {
    this.customLogger.log('Fetching all users', 'UserService');
    const users = await this.userModel
      .find()
      .select('-password')
      .populate('businessId', 'name')
      .exec();
    return users;
  }

  async findOne(id: string) {
    this.customLogger.log(`Fetching user with id: ${id}`, 'UserService');
    const user = await this.userModel
      .findById(id)
      .select('-password')
      .populate('businessId', 'name')
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string) {
    return await this.userModel.findOne({ email }).exec();
  }

  /**
   * Admin API: Create a new user with specific role and password
   */
  async adminCreateUser(createUserDto: CreateUserDto) {
    this.customLogger.log(
      `Admin creating user with email: ${createUserDto.email}, role: ${createUserDto.role}`,
      'UserService',
    );

    // Validate email uniqueness (case-insensitive)
    const escapedEmail = createUserDto.email.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    const existing = await this.userModel.findOne({
      email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    if (!createUserDto.password) {
      throw new BadRequestException('Password is required when creating a user');
    }

    // Hash password with argon2
    const hashedPassword = await argon2.hash(createUserDto.password);

    // Create auth user record
    const user = await this.userModel.create({
      fullName: createUserDto.fullName,
      email: createUserDto.email,
      password: hashedPassword,
      role: createUserDto.role || 'customer',
      phoneNumber: createUserDto.phoneNumber,
      country: createUserDto.country,
      city: createUserDto.city,
      postalCode: createUserDto.postalCode,
      sector: createUserDto.sector,
      avatar: createUserDto.avatar,
      businessId: createUserDto.businessId,
      status: createUserDto.status || 'ACTIVE',
      verified: true, // Admin-created users are pre-verified
      tokenVersion: 0,
      provider: 'local',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create corresponding security profile
    await this.authSecurityModel.create({
      authId: user._id.toString(),
      failedAttempts: 0,
      mfaEnabled: false,
    });

    return this.findOne(user._id.toString());
  }

  /**
   * Admin API: Set or reset password for any user
   */
  async adminSetPassword(userId: string, newPassword: string) {
    this.customLogger.log(
      `Admin setting password for user ID: ${userId}`,
      'UserService',
    );

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const hashedPassword = await argon2.hash(newPassword);
    user.password = hashedPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // Invalidate all active tokens
    user.updatedAt = new Date();
    await user.save();

    return {
      statusCode: 200,
      message: 'Password updated successfully. All active sessions have been invalidated.',
    };
  }

  /**
   * Admin API: Delete a user (soft delete by default, or permanent delete)
   */
  async adminDeleteUser(userId: string, permanent: boolean = false) {
    this.customLogger.log(
      `Admin deleting user ID: ${userId} (permanent: ${permanent})`,
      'UserService',
    );

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (permanent) {
      await this.userModel.findByIdAndDelete(userId);
      await this.authSecurityModel.deleteMany({ authId: userId });
      return {
        statusCode: 200,
        message: 'User permanently deleted successfully.',
      };
    }

    user.status = 'DELETED';
    user.deletedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1; // Invalidate active tokens
    user.updatedAt = new Date();
    await user.save();

    return {
      statusCode: 200,
      message: 'User deleted (deactivated) successfully.',
    };
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    avatarFile?: Express.Multer.File,
    actorRole?: string,
  ) {
    this.customLogger.log(`Updating user with id: ${id}`, 'UserService');

    // Disallow direct password manipulation via generic update (use dedicated set-password endpoint)
    if (updateUserDto.password !== undefined) {
      throw new ForbiddenException(
        'Password cannot be updated from this endpoint. Use the password management endpoint.',
      );
    }

    // Non-admin cannot modify protected fields
    if (actorRole !== 'admin') {
      const forbiddenFields: Array<keyof UpdateUserDto> = [
        'businessId',
        'email',
        'role',
        'status',
      ];

      const hasForbiddenField = forbiddenFields.some(
        (field) => updateUserDto[field] !== undefined,
      );
      if (hasForbiddenField) {
        throw new ForbiddenException(
          'You cannot update protected fields (like email, role, status, or businessId) without admin privileges.',
        );
      }
    }

    if (avatarFile) {
      const uploadedAvatar = await this.cloudinaryService.uploadImage(
        avatarFile.buffer,
        'user-avatars',
      );
      updateUserDto.avatar = uploadedAvatar.url;
    }

    const safePayload = this.buildSafeProfileUpdatePayload(
      updateUserDto,
      actorRole,
    );

    const user = await this.userModel
      .findByIdAndUpdate(
        id,
        { ...safePayload, updatedAt: new Date() },
        { new: true },
      )
      .select('-password')
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  private buildSafeProfileUpdatePayload(
    updateUserDto: UpdateUserDto,
    actorRole?: string,
  ): Partial<AuthUser> {
    const allowedFields: Array<keyof UpdateUserDto> = [
      'fullName',
      'phoneNumber',
      'country',
      'city',
      'postalCode',
      'sector',
      'avatar',
    ];

    if (actorRole === 'admin') {
      allowedFields.push('status', 'role', 'email');
    }

    const safePayload: Partial<AuthUser> = {};

    for (const field of allowedFields) {
      const value = updateUserDto[field];

      if (value !== undefined) {
        (safePayload as Record<string, any>)[field] = value;
      }
    }

    return safePayload;
  }
}
