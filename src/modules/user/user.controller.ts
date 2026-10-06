import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Patch,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdminSetPasswordDto } from './dto/admin-set-password.dto';
import {
  ApiResponseDecorator,
  ApiArrayResponseDecorator,
} from '../../common/decorators';
import { User } from './entities/user.entity';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../auth/interfaces/auth.interface';
import { Types } from 'mongoose';

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
@Controller('user')
@UseGuards(AuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({
    summary: 'Get all users',
    description: 'Admin-only endpoint that returns all user profiles.',
  })
  @ApiArrayResponseDecorator(200, 'Users retrieved successfully', User)
  @ApiForbiddenResponse({ description: 'Only admin users can list users.' })
  @Roles(UserRole.ADMIN)
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @ApiOperation({
    summary: 'Create user (Admin only)',
    description:
      'Creates a new user profile with a specific role, password, and pre-verified status.',
  })
  @ApiCreatedResponse({
    description: 'User created successfully.',
    type: User,
  })
  @ApiForbiddenResponse({ description: 'Only admin users can create users.' })
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.adminCreateUser(createUserDto);
  }

  @ApiOperation({
    summary: 'Get my profile',
    description:
      'Returns the profile for the authenticated user attached to the JWT.',
  })
  @ApiResponseDecorator(200, 'User retrieved successfully', User)
  @Get('me')
  findMe(@Request() req: { user: { userId: string } }) {
    return this.userService.findOne(req.user.userId);
  }

  @ApiOperation({
    summary: 'Get user by ID',
    description:
      'Admins can fetch any profile. Non-admin users can only fetch their own profile.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB user ID.',
    example: '65f1c2a6e5b9a2d8a4f2c111',
  })
  @ApiResponseDecorator(200, 'User retrieved successfully', User)
  @ApiBadRequestResponse({ description: 'Invalid user ID format.' })
  @ApiForbiddenResponse({
    description: 'Authenticated user can only access their own profile.',
  })
  @ApiNotFoundResponse({ description: 'User was not found.' })
  @Get(':id')
  findOneById(
    @Param('id') id: string,
    @Request() req: { user: { userId: string; role: string } },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id format');
    }

    if (req.user.role !== 'admin' && req.user.userId !== id) {
      throw new ForbiddenException('You can only access your own profile');
    }

    return this.userService.findOne(id);
  }

  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Updates profile fields for the authenticated user and optionally uploads an avatar image.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'User profile fields and optional avatar image file',
    schema: {
      type: 'object',
      properties: {
        fullName: { type: 'string' },
        phoneNumber: { type: 'string' },
        country: { type: 'string' },
        city: { type: 'string' },
        postalCode: { type: 'number' },
        sector: { type: 'string' },
        avatar: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponseDecorator(200, 'User updated successfully', User)
  @ApiBadRequestResponse({
    description: 'Invalid profile payload or non-image avatar upload.',
  })
  @Patch('me')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  updateMe(
    @Request() req: { user: { userId: string; role: string } },
    @Body() updateUserDto: UpdateUserDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    return this.userService.update(
      req.user.userId,
      updateUserDto,
      avatar,
      req.user.role,
    );
  }

  @ApiOperation({
    summary: 'Update user by ID',
    description:
      'Admins can update any profile (including role, status, email). Non-admin users can only update their own profile.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB user ID.',
    example: '65f1c2a6e5b9a2d8a4f2c111',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'User profile fields and optional avatar image file',
    schema: {
      type: 'object',
      properties: {
        fullName: { type: 'string' },
        email: { type: 'string' },
        role: {
          type: 'string',
          enum: [
            'customer',
            'businessowner',
            'admin',
            'story_manager',
            'operations_manager',
          ],
        },
        status: { type: 'string' },
        phoneNumber: { type: 'string' },
        country: { type: 'string' },
        city: { type: 'string' },
        postalCode: { type: 'number' },
        sector: { type: 'string' },
        avatar: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponseDecorator(200, 'User updated successfully', User)
  @ApiBadRequestResponse({
    description:
      'Invalid user ID, invalid payload, or non-image avatar upload.',
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user can only update their own profile.',
  })
  @ApiNotFoundResponse({ description: 'User was not found.' })
  @Patch(':id')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  updateById(
    @Param('id') id: string,
    @Request() req: { user: { userId: string; role: string } },
    @Body() updateUserDto: UpdateUserDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id format');
    }

    if (req.user.role !== 'admin' && req.user.userId !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }

    return this.userService.update(id, updateUserDto, avatar, req.user.role);
  }

  @ApiOperation({
    summary: 'Set user password (Admin only)',
    description:
      'Sets or resets a password for any user directly and revokes all active tokens.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB user ID.',
    example: '65f1c2a6e5b9a2d8a4f2c111',
  })
  @ApiResponseDecorator(200, 'Password updated successfully')
  @ApiForbiddenResponse({
    description: 'Only admin users can set user passwords.',
  })
  @Roles(UserRole.ADMIN)
  @Patch(':id/password')
  setPassword(
    @Param('id') id: string,
    @Body() adminSetPasswordDto: AdminSetPasswordDto,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id format');
    }

    return this.userService.adminSetPassword(
      id,
      adminSetPasswordDto.password,
    );
  }

  @ApiOperation({
    summary: 'Delete user (Admin only)',
    description:
      'Deactivates (soft delete) or permanently deletes a user profile.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB user ID.',
    example: '65f1c2a6e5b9a2d8a4f2c111',
  })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Pass true to permanently delete the document from the database.',
  })
  @ApiResponseDecorator(200, 'User deleted successfully')
  @ApiForbiddenResponse({ description: 'Only admin users can delete users.' })
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  deleteUser(
    @Param('id') id: string,
    @Query('permanent') permanent?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id format');
    }

    return this.userService.adminDeleteUser(id, permanent === 'true');
  }
}
