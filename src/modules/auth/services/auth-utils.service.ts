import { Injectable } from '@nestjs/common';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { Response } from 'express';
import httpStatus from 'http-status';
import config from '../../../common/config/app.config';
import {
  IAccessTokenPayload,
  IRefreshTokenPayload,
  ITokenPayload,
  UserRole,
} from '../interfaces/auth.interface';
import { AUTH_CONFIG } from '../config/auth.config';
import { RedisService } from '../../../common/services/redis.service';
import { CryptoService } from '../../../common/services/crypto.service';
import AppError from '../../../common/errors/app.error';

interface TokenOptions {
  isRefresh?: boolean;
  expiresIn?: SignOptions['expiresIn'];
}

/**
 * Authentication Utility Service
 * Provides various authentication-related utilities
 */
@Injectable()
export class AuthUtilsService {
  constructor(
    private readonly redisService: RedisService,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * Auth-specific Redis rate limiting is enabled by default only in production.
   * Set AUTH_RATE_LIMIT_ENABLED=true to force-enable in non-production.
   */
  private isAuthRateLimitEnabled(): boolean {
    const explicitFlag = process.env.AUTH_RATE_LIMIT_ENABLED;

    if (explicitFlag !== undefined) {
      return explicitFlag.toLowerCase() === 'true';
    }

    return config.node_env.toLowerCase() === 'production';
  }

  /**
   * Generates a cryptographically secure random ID
   * Used for JTI (JWT ID) to prevent collisions
   */
  generateSecureId(): string {
    return this.cryptoService.generateSecureId();
  }

  /**
   * Generates a random verification code
   */
  generateVerificationCode = (): string => {
    return this.cryptoService.generateSecureOtp(6);
  };

  /**
   * Hash a token using SHA-256 for secure storage
   * Never store raw tokens - only hashes
   */
  hashToken(token: string): string {
    return this.cryptoService.hashToken(token);
  }

  /**
   * Creates an access token (stateless, minimal payload)
   */
  createAccessToken(
    payload: IAccessTokenPayload,
    expiresIn?: SignOptions['expiresIn'],
  ): string {
    const secret = config.jwt_access_secret;
    if (!secret) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'JWT access secret is not configured',
      );
    }

    const signOptions: SignOptions = {
      expiresIn: expiresIn || AUTH_CONFIG.TOKEN_EXPIRY.ACCESS,
      algorithm: 'HS256',
    };

    return jwt.sign(payload, secret, signOptions);
  }

  /**
   * Creates a refresh token with JTI for revocation capability
   */
  createRefreshToken(
    payload: IRefreshTokenPayload,
    jti: string,
    expiresIn?: SignOptions['expiresIn'],
  ): string {
    const secret = config.jwt_refresh_secret;
    if (!secret) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'JWT refresh secret is not configured',
      );
    }

    const signOptions: SignOptions = {
      expiresIn: expiresIn || AUTH_CONFIG.TOKEN_EXPIRY.REFRESH,
      algorithm: 'HS256',
      jwtid: jti, // Embed JTI in JWT standard claim
    };

    return jwt.sign(payload, secret, signOptions);
  }

  /**
   * @deprecated Use createAccessToken or createRefreshToken
   * Creates a JWT token with proper options
   */
  createToken(payload: ITokenPayload, options: TokenOptions = {}): string {
    const { isRefresh = false, expiresIn } = options;
    const secret = isRefresh
      ? config.jwt_refresh_secret
      : config.jwt_access_secret;
    const defaultExpiry = isRefresh ? '7d' : '1h';

    const signOptions: SignOptions = {
      expiresIn: expiresIn || defaultExpiry,
      algorithm: 'HS256',
    };

    if (!secret) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'JWT secret is not configured',
      );
    }

    return jwt.sign(payload, secret, signOptions);
  }

  /**
   * Verifies an access token
   */
  verifyAccessToken(token: string): IAccessTokenPayload & JwtPayload {
    const secret = config.jwt_access_secret;
    if (!secret) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'JWT access secret is not configured',
      );
    }
    return jwt.verify(token, secret) as IAccessTokenPayload & JwtPayload;
  }

  /**
   * Verifies a refresh token and returns payload with JTI
   */
  verifyRefreshToken(token: string): IRefreshTokenPayload & JwtPayload {
    const secret = config.jwt_refresh_secret;
    if (!secret) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'JWT refresh secret is not configured',
      );
    }
    return jwt.verify(token, secret) as IRefreshTokenPayload & JwtPayload;
  }

  /**
   * @deprecated Use verifyAccessToken or verifyRefreshToken
   * Verifies a JWT token
   */
  verifyToken(token: string): JwtPayload {
    const secret = config.jwt_access_secret;
    if (!secret) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'JWT secret is not configured',
      );
    }
    return jwt.verify(token, secret) as JwtPayload;
  }

  /**
   * Removes user tokens from cache and cookies
   */
  async removeTokens(
    res: Response,
    prefix: string,
    email: string,
  ): Promise<void> {
    const accessTokenKey = `${prefix}:user:${email}:accessToken`;
    const refreshTokenKey = `${prefix}:user:${email}:refreshToken`;

    await Promise.all([
      this.redisService.del(accessTokenKey),
      this.redisService.del(refreshTokenKey),
    ]);

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
  }

  /**
   * Checks rate limiting for operations
   */
  async checkRateLimit(
    key: string,
    maxAttempts: number,
    windowMs: number,
  ): Promise<boolean> {
    // Keep development/testing iteration smooth unless explicitly enabled.
    if (!this.isAuthRateLimitEnabled()) {
      return true;
    }

    const cacheKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.RATE_LIMIT}${key}`;
    const lockKey = `${cacheKey}:locked`;

    // First check if we're in a locked state
    const isLocked = await this.redisService.exists(lockKey);
    if (isLocked) {
      throw new AppError(
        httpStatus.TOO_MANY_REQUESTS,
        `Rate limit exceeded. Please try again after ${windowMs / 1000} seconds.`,
      );
    }

    // Use Redis INCR to atomically increment the counter
    const currentAttempts = await this.redisService.incr(cacheKey);

    // Set expiry on first attempt
    if (currentAttempts === 1) {
      await this.redisService.expire(cacheKey, windowMs / 1000);
    }

    if (currentAttempts && currentAttempts > maxAttempts) {
      // Set a lock with TTL instead of continuing to increment
      await this.redisService.set(lockKey, '1', windowMs / 1000);
      throw new AppError(
        httpStatus.TOO_MANY_REQUESTS,
        `Rate limit exceeded. Please try again after ${windowMs / 1000} seconds.`,
      );
    }

    return true;
  }

  /**
   * Validates password strength
   */
  validatePassword(password: string): boolean {
    const { PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENTS } = AUTH_CONFIG;

    if (password.length < PASSWORD_MIN_LENGTH) {
      return false;
    }

    if (PASSWORD_REQUIREMENTS.UPPERCASE && !/[A-Z]/.test(password)) {
      return false;
    }

    if (PASSWORD_REQUIREMENTS.LOWERCASE && !/[a-z]/.test(password)) {
      return false;
    }

    if (PASSWORD_REQUIREMENTS.NUMBERS && !/\d/.test(password)) {
      return false;
    }

    if (
      PASSWORD_REQUIREMENTS.SPECIAL_CHARS &&
      !/[!@#$%^&*(),.?":{}|<>]/.test(password)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Checks if a user can modify another user's role based on role hierarchy
   */
  canModifyRole(
    currentUserRole: UserRole,
    targetUserRole: UserRole,
    newRole: UserRole,
  ): boolean {
    const { ROLE_HIERARCHY } = AUTH_CONFIG;
    const roleLevels: Record<UserRole, number> = {
      [UserRole.CUSTOMER]: ROLE_HIERARCHY.customer,
      [UserRole.BUSINESS_OWNER]: ROLE_HIERARCHY.businessowner,
      [UserRole.STORY_MANAGER]: ROLE_HIERARCHY.story_manager,
      [UserRole.OPERATIONS_MANAGER]: ROLE_HIERARCHY.operations_manager,
      [UserRole.ADMIN]: ROLE_HIERARCHY.admin,
    };

    // Admin can only modify lower-level roles
    if (currentUserRole === UserRole.ADMIN) {
      const targetRoleLevel = roleLevels[targetUserRole] || 0;
      const newRoleLevel = roleLevels[newRole] || 0;
      const adminLevel = roleLevels[UserRole.ADMIN];

      return targetRoleLevel < adminLevel && newRoleLevel < adminLevel;
    }

    // Customer cannot modify any roles
    if (currentUserRole === UserRole.CUSTOMER) {
      return false;
    }

    return false;
  }
}
