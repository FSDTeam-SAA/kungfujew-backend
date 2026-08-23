import { ConfigService } from '@nestjs/config';
import { Redis as RedisClient } from 'ioredis';
import { createHash } from 'node:crypto';
import {
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  WebhookSecurityService,
  WebhookProvider,
} from './webhook-security.service';

describe('WebhookSecurityService', () => {
  const token = 'provider-generated-webhook-token';
  const configValues: Record<string, string | undefined> = {
    SUPER_DISPATCH_WEBHOOK_TOKEN_SHA256: createHash('sha256')
      .update(token)
      .digest('hex'),
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;
  const redisClient = {
    set: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  } as unknown as RedisClient;
  const service = new WebhookSecurityService(configService, redisClient);

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.SUPER_DISPATCH_WEBHOOK_TOKEN_SHA256 = createHash('sha256')
      .update(token)
      .digest('hex');
  });

  it('accepts a secure callback token that matches the configured hash', () => {
    expect(() =>
      service.assertSecureToken(WebhookProvider.SUPER_DISPATCH, token),
    ).not.toThrow();
  });

  it('rejects an invalid secure callback token', () => {
    expect(() =>
      service.assertSecureToken(
        WebhookProvider.SUPER_DISPATCH,
        'invalid-token',
      ),
    ).toThrow(UnauthorizedException);
  });

  it('does not expose a secure route until its token hash is configured', () => {
    expect(() =>
      service.assertSecureToken(WebhookProvider.TAILWIND_TMS, token),
    ).toThrow(ServiceUnavailableException);
  });

  it('rejects an invalid configured token hash', () => {
    configValues.SUPER_DISPATCH_WEBHOOK_TOKEN_SHA256 = 'not-a-sha256-hash';

    expect(() =>
      service.assertSecureToken(WebhookProvider.SUPER_DISPATCH, token),
    ).toThrow(ServiceUnavailableException);
  });

  it('processes an event only once while its replay key is retained', async () => {
    (redisClient.set as jest.Mock)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);
    (redisClient.expire as jest.Mock).mockResolvedValue(1);
    const handler = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.processOnce(
        WebhookProvider.SUPER_DISPATCH,
        'delivery.notification:remote-order:2026-08-23T00:00:00.000Z',
        handler,
      ),
    ).resolves.toBe(true);

    await expect(
      service.processOnce(
        WebhookProvider.SUPER_DISPATCH,
        'delivery.notification:remote-order:2026-08-23T00:00:00.000Z',
        handler,
      ),
    ).resolves.toBe(false);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
