import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AuthUser, AuthSecurity } from '../../database/schemas';
import { CustomLoggerService } from '../../common/services/custom-logger.service';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { AuthService } from '../auth/auth.service';
import { AuthUtilsService } from '../auth/services/auth-utils.service';
import { UserService } from './user.service';

describe('UserService security actions', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const user = {
    _id: { toString: () => 'user-id' },
    password: 'old-hash',
    status: 'ACTIVE',
    tokenVersion: 1,
    save,
  };
  const userModel = {
    findById: jest.fn().mockResolvedValue(user),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const authService = {
    invalidateUserSessions: jest.fn().mockResolvedValue(undefined),
  };
  const authUtils = {
    validatePassword: jest.fn(
      (password: string) =>
        password.length >= 8 &&
        /[a-z]/.test(password) &&
        /\d/.test(password) &&
        /!/.test(password),
    ),
  };
  let service: UserService;

  beforeEach(async () => {
    jest.clearAllMocks();
    user.status = 'ACTIVE';
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getModelToken(AuthUser.name), useValue: userModel },
        {
          provide: getModelToken(AuthSecurity.name),
          useValue: { create: jest.fn() },
        },
        { provide: CustomLoggerService, useValue: { log: jest.fn() } },
        { provide: CloudinaryService, useValue: {} },
        { provide: AuthService, useValue: authService },
        { provide: AuthUtilsService, useValue: authUtils },
      ],
    }).compile();
    service = module.get(UserService);
  });

  it('rejects a weak admin-set password before changing the account', async () => {
    await expect(
      service.adminSetPassword('user-id', 'abcdefgh'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
    expect(authService.invalidateUserSessions).not.toHaveBeenCalled();
  });

  it('invalidates sessions after setting a valid password', async () => {
    await service.adminSetPassword('user-id', 'strong1!pass');
    expect(save).toHaveBeenCalledTimes(1);
    expect(authService.invalidateUserSessions).toHaveBeenCalledWith('user-id');
  });

  it('invalidates sessions after an admin role change', async () => {
    const updated = { role: 'story_manager', status: 'ACTIVE' };
    userModel.findByIdAndUpdate.mockReturnValue({
      select: () => ({ exec: () => Promise.resolve(updated) }),
    });
    await service.update(
      'user-id',
      { role: 'story_manager' },
      undefined,
      'admin',
    );
    expect(authService.invalidateUserSessions).toHaveBeenCalledWith('user-id');
  });

  it('invalidates sessions after soft deletion', async () => {
    await service.adminDeleteUser('user-id');
    expect(user.status).toBe('DELETED');
    expect(save).toHaveBeenCalledTimes(1);
    expect(authService.invalidateUserSessions).toHaveBeenCalledWith('user-id');
  });

  it('rejects weak passwords for admin-created users', async () => {
    await expect(
      service.adminCreateUser({
        email: 'staff@example.com',
        fullName: 'Staff',
        password: 'abcdefgh',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userModel.create).not.toHaveBeenCalled();
  });
});
