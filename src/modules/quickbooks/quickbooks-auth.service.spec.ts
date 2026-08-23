import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { of } from 'rxjs';
import { Redis as RedisClient } from 'ioredis';
import { IQuickBooksConnection } from './schemas/quickbooks-connection.schema';
import { QuickBooksAuthService } from './quickbooks-auth.service';

describe('QuickBooksAuthService', () => {
  const configValues: Record<string, string> = {
    QB_CLIENT_ID: 'client-id',
    QB_CLIENT_SECRET: 'client-secret',
    QB_REDIRECT_URI: 'https://api.example.com/quickbooks/oauth/callback',
    QB_ENVIRONMENT: 'production',
  };

  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  const httpServiceMock = {
    post: jest.fn(),
  };
  const httpService = httpServiceMock as unknown as HttpService;

  const connectionModelMock = {
    updateOne: jest.fn(),
  };
  const connectionModel =
    connectionModelMock as unknown as Model<IQuickBooksConnection>;

  const redisClientMock = {
    set: jest.fn(),
    getdel: jest.fn(),
  };
  const redisClient = redisClientMock as unknown as RedisClient;

  const service = new QuickBooksAuthService(
    configService,
    httpService,
    connectionModel,
    redisClient,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores a one-time state before returning the authorization URL', async () => {
    redisClientMock.set.mockResolvedValue('OK');

    const authorizationUrl = await service.getAuthorizationUrl('admin-user-id');

    const url = new URL(authorizationUrl);
    expect(url.searchParams.get('state')).toEqual(expect.any(String));
    expect(redisClientMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^quickbooks:oauth-state:[a-f0-9]{64}$/),
      'admin-user-id',
      'EX',
      600,
      'NX',
    );
  });

  it('rejects a callback whose state was not issued by the application', async () => {
    redisClientMock.getdel.mockResolvedValue(null);

    await expect(
      service.handleOAuthCallback(
        'authorization-code',
        'realm-id',
        'unknown-state',
      ),
    ).resolves.toEqual({
      success: false,
      error: 'Invalid or expired OAuth state',
    });

    expect(httpServiceMock.post).not.toHaveBeenCalled();
  });

  it('rejects a callback without state before reading Redis', async () => {
    await expect(
      service.handleOAuthCallback('authorization-code', 'realm-id', ''),
    ).resolves.toEqual({
      success: false,
      error: 'Invalid or expired OAuth state',
    });

    expect(redisClientMock.getdel).not.toHaveBeenCalled();
  });

  it('consumes a valid state before exchanging the authorization code', async () => {
    redisClientMock.getdel.mockResolvedValue('admin-user-id');
    httpServiceMock.post.mockReturnValue(
      of({
        data: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          x_refresh_token_expires_in: 7200,
        },
      }),
    );
    connectionModelMock.updateOne.mockResolvedValue(undefined);

    await expect(
      service.handleOAuthCallback(
        'authorization-code',
        'realm-id',
        'issued-state',
      ),
    ).resolves.toEqual({ success: true });

    expect(redisClientMock.getdel).toHaveBeenCalledWith(
      expect.stringMatching(/^quickbooks:oauth-state:[a-f0-9]{64}$/),
    );
    expect(connectionModelMock.updateOne).toHaveBeenCalled();
  });
});
