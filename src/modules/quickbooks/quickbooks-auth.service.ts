import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { createHash, randomBytes } from 'node:crypto';
import { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import {
  IQuickBooksConnection,
  QuickBooksConnectionModel,
} from './schemas/quickbooks-connection.schema';

@Injectable()
export class QuickBooksAuthService {
  private readonly logger = new Logger(QuickBooksAuthService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly environment: string;
  private static readonly OAUTH_STATE_TTL_SECONDS = 600;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectModel(QuickBooksConnectionModel.name)
    private readonly connectionModel: Model<IQuickBooksConnection>,
    @Inject(REDIS_CLIENT) private readonly redisClient: RedisClient,
  ) {
    this.clientId = this.getConfigValue('QB_CLIENT_ID', 'QUICKBOOKS_CLIENT_ID');
    this.clientSecret = this.getConfigValue(
      'QB_CLIENT_SECRET',
      'QUICKBOOKS_CLIENT_SECRET',
    );
    this.redirectUri =
      this.configService.get<string>('QB_REDIRECT_URI') ||
      'http://localhost:5000/quickbooks/oauth/callback';
    this.environment =
      this.configService.get<string>('QB_ENVIRONMENT') || 'sandbox';
  }

  async getAuthorizationUrl(adminUserId: string): Promise<string> {
    this.assertConfigured();

    const state = randomBytes(32).toString('base64url');
    const stateStored = await this.redisClient.set(
      this.getStateKey(state),
      adminUserId,
      'EX',
      QuickBooksAuthService.OAUTH_STATE_TTL_SECONDS,
      'NX',
    );

    if (stateStored !== 'OK') {
      throw new Error('Unable to start QuickBooks authorization');
    }

    const baseUrl =
      this.environment === 'production'
        ? 'https://appcenter.intuit.com/connect/oauth2'
        : 'https://appcenter.intuit.com/connect/oauth2';

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: this.redirectUri,
      state,
    });

    return `${baseUrl}?${params.toString()}`;
  }

  async handleOAuthCallback(
    code: string,
    realmId: string,
    state: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!state) {
        return { success: false, error: 'Invalid or expired OAuth state' };
      }

      const stateOwner = await this.redisClient.getdel(this.getStateKey(state));
      if (!stateOwner) {
        return { success: false, error: 'Invalid or expired OAuth state' };
      }

      this.assertConfigured();
      const tokenUrl =
        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
      const credentials = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      });

      const response = await firstValueFrom(
        this.httpService.post<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
          x_refresh_token_expires_in: number;
        }>(tokenUrl, body.toString(), {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }),
      );

      const {
        access_token,
        refresh_token,
        expires_in,
        x_refresh_token_expires_in,
      } = response.data;

      await this.connectionModel.updateOne(
        { realmId },
        {
          $set: {
            realmId,
            accessToken: access_token,
            refreshToken: refresh_token,
            accessTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
            refreshTokenExpiresAt: new Date(
              Date.now() + x_refresh_token_expires_in * 1000,
            ),
            isActive: true,
            connectedAt: new Date(),
          },
        },
        { upsert: true },
      );

      this.logger.log(`QuickBooks connected for realm ${realmId}`);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`QuickBooks OAuth callback failed: ${message}`);
      return { success: false, error: message };
    }
  }

  async getAccessToken(): Promise<string | null> {
    const connection = await this.connectionModel
      .findOne({ isActive: true })
      .sort({ connectedAt: -1 })
      .exec();

    if (!connection) return null;

    if (new Date() < connection.accessTokenExpiresAt) {
      return connection.accessToken;
    }

    return this.refreshAccessToken(connection);
  }

  private async refreshAccessToken(
    connection: IQuickBooksConnection,
  ): Promise<string | null> {
    try {
      const tokenUrl =
        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
      const credentials = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refreshToken,
      });

      const response = await firstValueFrom(
        this.httpService.post<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
          x_refresh_token_expires_in: number;
        }>(tokenUrl, body.toString(), {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      const {
        access_token,
        refresh_token,
        expires_in,
        x_refresh_token_expires_in,
      } = response.data;

      await this.connectionModel.updateOne(
        { realmId: connection.realmId },
        {
          $set: {
            accessToken: access_token,
            refreshToken: refresh_token,
            accessTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
            refreshTokenExpiresAt: new Date(
              Date.now() + x_refresh_token_expires_in * 1000,
            ),
            lastSyncAt: new Date(),
          },
        },
      );

      return access_token;
    } catch (error) {
      this.logger.error(
        `QuickBooks token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async disconnect(): Promise<void> {
    await this.connectionModel.updateMany(
      { isActive: true },
      { $set: { isActive: false } },
    );
  }

  async getConnectionStatus(): Promise<{
    connected: boolean;
    companyName?: string;
    realmId?: string;
  }> {
    const connection = await this.connectionModel
      .findOne({ isActive: true })
      .sort({ connectedAt: -1 })
      .exec();

    if (!connection) return { connected: false };

    return {
      connected: true,
      companyName: connection.companyName,
      realmId: connection.realmId,
    };
  }

  private getConfigValue(primaryKey: string, legacyKey: string): string {
    const primaryValue = this.configService.get<string>(primaryKey);
    if (primaryValue) {
      return primaryValue;
    }

    const legacyValue = this.configService.get<string>(legacyKey);
    if (legacyValue) {
      this.logger.warn(
        `${legacyKey} is deprecated; use ${primaryKey} instead.`,
      );
      return legacyValue;
    }

    return '';
  }

  private assertConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error('QuickBooks credentials are not configured');
    }
  }

  private getStateKey(state: string): string {
    const stateHash = createHash('sha256').update(state).digest('hex');
    return `quickbooks:oauth-state:${stateHash}`;
  }
}
