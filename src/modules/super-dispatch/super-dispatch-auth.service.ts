import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/modules/redis.module';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  [key: string]: unknown;
}

@Injectable()
export class SuperDispatchAuthService implements OnModuleInit {
  private readonly logger = new Logger(SuperDispatchAuthService.name);
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redisKey = 'super-dispatch:access-token';
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.tokenUrl =
      this.configService.get<string>('SUPER_DISPATCH_TOKEN_URL') ||
      'https://api.shipper.superdispatch.com/oauth/token?grant_type=client_credentials';
    this.clientId =
      this.configService.get<string>('SUPER_DISPATCH_CLIENT_ID') || '';
    this.clientSecret =
      this.configService.get<string>('SUPER_DISPATCH_CLIENT_SECRET') || '';
  }

  async onModuleInit(): Promise<void> {
    if (!this.hasCredentials()) {
      this.logger.warn(
        'Super Dispatch credentials are not configured; token refresh will be skipped until credentials are provided.',
      );
      return;
    }

    await this.getAccessToken();
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 300000) {
      return this.cachedToken;
    }

    const cached = await this.redis.get(this.redisKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { token: string; expiresAt: number };
      if (Date.now() < parsed.expiresAt - 300000) {
        this.cachedToken = parsed.token;
        this.tokenExpiresAt = parsed.expiresAt;
        return parsed.token;
      }
    }

    return this.fetchNewToken();
  }

  private async fetchNewToken(): Promise<string> {
    if (!this.hasCredentials()) {
      throw new Error(
        'Super Dispatch credentials are not configured. Set SUPER_DISPATCH_CLIENT_ID and SUPER_DISPATCH_CLIENT_SECRET.',
      );
    }

    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');

    const response = await firstValueFrom(
      this.httpService.post<TokenResponse>(
        this.tokenUrl,
        {},
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            Accept: 'application/json',
          },
        },
      ),
    );

    const { access_token, expires_in } = response.data;
    const expiresAt = Date.now() + expires_in * 1000;

    this.cachedToken = access_token;
    this.tokenExpiresAt = expiresAt;

    await this.redis.set(
      this.redisKey,
      JSON.stringify({ token: access_token, expiresAt }),
      'EX',
      expires_in,
    );

    return access_token;
  }

  private hasCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  async invalidateToken(): Promise<void> {
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
    await this.redis.del(this.redisKey);
  }
}
