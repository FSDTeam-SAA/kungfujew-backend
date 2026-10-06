import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  MinLength,
  MaxLength,
} from 'class-validator';

import { UserRole } from '../../auth/interfaces/auth.interface';
export { UserRole };

export class CreateUserDto {
  @ApiProperty({ example: 'John Doe', description: 'User full name' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  fullName: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'User phone number',
    required: false,
  })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({
    example: 'United States',
    description: 'User country',
    required: false,
  })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({
    example: 'New York',
    description: 'User city',
    required: false,
  })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({
    example: 10001,
    description: 'User postal code',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  postalCode?: number;

  @ApiProperty({
    example: 'Technology',
    description: 'User sector',
    required: false,
  })
  @IsString()
  @IsOptional()
  sector?: string;

  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd', description: 'User password' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @ApiProperty({
    example: 'customer',
    description: 'User role',
    enum: UserRole,
    default: 'customer',
    required: false,
  })
  @IsEnum(UserRole, { message: 'Invalid role' })
  @IsOptional()
  role?: UserRole;

  @ApiProperty({
    example: 'https://example.com/avatar.jpg',
    description: 'User avatar URL',
    required: false,
  })
  @IsString()
  @IsOptional()
  avatar?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439012',
    description: 'Business ID reference',
    required: false,
  })
  @IsString()
  @IsOptional()
  businessId?: string;

  @ApiProperty({
    example: 'ACTIVE',
    description: 'User account status',
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'BLOCKED'],
    required: false,
  })
  @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'BLOCKED'], {
    message: 'Invalid status',
  })
  @IsOptional()
  status?: string;
}
