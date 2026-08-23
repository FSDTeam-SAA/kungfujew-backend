import {
  GoneException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from '../modules/redis.module';

export enum WebhookProvider {
  SUPER_DISPATCH = 'super-dispatch',
  TAILWIND_TMS = 'tailwind-tms',
}

const TOKEN_HASH_ENV_KEY: Record<WebhookProvider, string> = {
  [WebhookProvider.SUPER_DISPATCH]: 'SUPER_DISPATCH_WEBHOOK_TOKEN_SHA256',
  [WebhookProvider.TAILWIND_TMS]: 'TAILWIND_TMS_WEBHOOK_TOKEN_SHA256',
};

const LEGACY_ENABLED_ENV_KEY: Record<WebhookProvider, string> = {
  [WebhookProvider.SUPER_DISPATCH]: 'SUPER_DISPATCH_LEGACY_WEBHOOK_ENABLED',
  [WebhookProvider.TAILWIND_TMS]: 'TAILWIND_TMS_LEGACY_WEBHOOK_ENABLED',
};

const PROCESSING_TTL_SECONDS = 300;
const REPLAY_TTL_SECONDS = 86400;

@Injectable()
export class WebhookSecurityService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redisClient: RedisClient,
  ) {}

  assertLegacyEndpointEnabled(provider: WebhookProvider): void {
    if (
      this.configService.get<string>(LEGACY_ENABLED_ENV_KEY[provider]) ===
      'false'
    ) {
      throw new GoneException('This webhook endpoint has been replaced');
    }
  }

  assertSecureToken(provider: WebhookProvider, token: string): void {
    const configuredHash = this.configService.get<string>(
      TOKEN_HASH_ENV_KEY[provider],
    );

    if (!configuredHash || !/^[a-f0-9]{64}$/i.test(configuredHash)) {
      throw new ServiceUnavailableException(
        'Secure webhook endpoint is not configured',
      );
    }

    const providedHash = createHash('sha256').update(token).digest('hex');
    const configuredBuffer = Buffer.from(configuredHash, 'hex');
    const providedBuffer = Buffer.from(providedHash, 'hex');

    if (
      configuredBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(configuredBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook token');
    }
  }

  async processOnce(
    provider: WebhookProvider,
    eventIdentifier: string,
    handler: () => Promise<void>,
  ): Promise<boolean> {
    const replayKey = this.getReplayKey(provider, eventIdentifier);
    const acquired = await this.redisClient.set(
      replayKey,
      'processing',
      'EX',
      PROCESSING_TTL_SECONDS,
      'NX',
    );

    if (acquired !== 'OK') {
      return false;
    }

    try {
      await handler();
      await this.redisClient.expire(replayKey, REPLAY_TTL_SECONDS);
      return true;
    } catch (error) {
      await this.redisClient.del(replayKey);
      throw error;
    }
  }

  private getReplayKey(
    provider: WebhookProvider,
    eventIdentifier: string,
  ): string {
    const identifierHash = createHash('sha256')
      .update(eventIdentifier)
      .digest('hex');
    return `webhook:${provider}:replay:${identifierHash}`;
  }
}
