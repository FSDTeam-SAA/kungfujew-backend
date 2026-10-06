import { ApiProperty } from '@nestjs/swagger';

/**
 * User entity for API responses
 * This is only needed for Swagger documentation
 */
export class User {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'User unique identifier',
  })
  id: string;

  @ApiProperty({ example: 'John Doe', description: 'User full name' })
  fullName: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'User phone number',
    required: false,
  })
  phoneNumber?: string;

  @ApiProperty({
    example: 'United States',
    description: 'User country',
    required: false,
  })
  country?: string;

  @ApiProperty({
    example: 'New York',
    description: 'User city',
    required: false,
  })
  city?: string;

  @ApiProperty({
    example: 10001,
    description: 'User postal code',
    required: false,
  })
  postalCode?: number;

  @ApiProperty({
    example: 'Technology',
    description: 'User sector',
    required: false,
  })
  sector?: string;

  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  email: string;

  @ApiProperty({
    example: 'customer',
    description: 'User role',
    enum: [
      'customer',
      'businessowner',
      'admin',
      'story_manager',
      'operations_manager',
    ],
  })
  role: string;

  @ApiProperty({
    example: 'https://example.com/avatar.jpg',
    description: 'User avatar URL',
    required: false,
  })
  avatar?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439012',
    description: 'Business ID reference',
    required: false,
  })
  businessId?: string;

  @ApiProperty({ example: true, description: 'Email verification status' })
  verified: boolean;

  @ApiProperty({
    example: '2026-02-03T10:00:00.000Z',
    description: 'Account creation date',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-02-03T10:00:00.000Z',
    description: 'Last update date',
  })
  updatedAt: Date;
}
