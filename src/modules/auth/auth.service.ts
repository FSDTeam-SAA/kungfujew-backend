/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { CreateAuthDto } from './dto/create-auth.dto';
import { AuthUtilsService } from './services/auth-utils.service';
import { MongooseHelper } from './services/mongoose-helper.service';
import { AUTH_CONFIG } from './config/auth.config';
import { ActivityLogService } from '../../common/services/activity-log.service';
import { RedisService } from '../../common/services/redis.service';
import { EmailQueueService } from '../../common/queues/email/email.queue';
import { CustomLoggerService } from '../../common/services/custom-logger.service';
import AppError from '../../common/errors/app.error';
import * as argon2 from 'argon2';
import config from '../../common/config/app.config';
import {
  AuthUser,
  AuthSecurity,
  EmailHistory,
  LoginHistory,
} from '../../database/schemas';
import {
  ILoginResponse,
  IRegistrationResponse,
  IStoredRefreshToken,
  UserRole,
} from './interfaces/auth.interface';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(AuthUser.name) private authUserModel: Model<AuthUser>,
    @InjectModel(AuthSecurity.name)
    private authSecurityModel: Model<AuthSecurity>,
    @InjectModel(EmailHistory.name)
    private emailHistoryModel: Model<EmailHistory>,
    @InjectModel(LoginHistory.name)
    private loginHistoryModel: Model<LoginHistory>,
    private readonly authUtilsService: AuthUtilsService,
    private readonly mongooseHelper: MongooseHelper,
    private readonly activityLogService: ActivityLogService,
    private readonly redisService: RedisService,
    private readonly emailQueueService: EmailQueueService,
    private readonly customLogger: CustomLoggerService,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private getEmailQuery(email: string) {
    // Escape special regex characters in the email, then do case-insensitive match
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { email: { $regex: new RegExp(`^${escaped}$`, 'i') } };
  }

  async create(
    payload: CreateAuthDto,
    meta: { ip: string; userAgent: string; device?: string },
  ): Promise<IRegistrationResponse> {
    const { email, password } = payload;
    const fullName = payload.fullName ?? payload.username;
    const { ip, userAgent, device } = meta;

    this.customLogger.log(
      `Registration attempt for email: ${email}, fullName: ${fullName}`,
      'AuthService',
    );

    // Security Check: Prevent public registration as an admin or manager
    if (
      payload.role === 'admin' ||
      payload.role === 'story_manager' ||
      payload.role === 'operations_manager'
    ) {
      this.customLogger.warn(
        `Public privileged role registration blocked for: ${email} (requested role: ${payload.role})`,
        'AuthService',
      );
      throw AppError.forbidden(
        'Cannot register with administrative or managerial roles publicly.',
      );
    }

    const { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } = AUTH_CONFIG.RATE_LIMIT;

    // Check rate limiting for email, IP, and user agent
    await Promise.all([
      this.authUtilsService.checkRateLimit(
        `login:email:${email}`,
        LOGIN_MAX_ATTEMPTS,
        LOGIN_WINDOW_MS,
      ),
      this.authUtilsService.checkRateLimit(
        `login:ip:${ip}`,
        LOGIN_MAX_ATTEMPTS,
        LOGIN_WINDOW_MS,
      ),
    ]);

    // Validate password strength
    if (!this.authUtilsService.validatePassword(password)) {
      throw AppError.badRequest('Password does not meet security requirements');
    }

    // Check if user already exists with email
    const existingUser = await this.authUserModel.findOne(
      this.getEmailQuery(email),
    );

    if (existingUser) {
      this.customLogger.warn(
        `Registration failed: Email already exists - ${email}`,
        'AuthService',
      );
      throw AppError.conflict('Email already exists!');
    }

    // Hash password
    const hashedPassword = await argon2.hash(password);

    // Create user with auth security in a transaction
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // Create auth user
      const user = await this.authUserModel.create(
        [
          {
            email,
            fullName,
            password: hashedPassword,
            role: payload.role || 'customer',
            verified: false,
            status: 'ACTIVE',
            provider: 'local',
          },
        ],
        { session },
      );

      const userId = user[0]._id.toString();

      // Create auth security record
      await this.authSecurityModel.create(
        [
          {
            authId: userId,
            failedAttempts: 0,
            mfaEnabled: false,
          },
        ],
        { session },
      );

      // Log user registration activity
      await this.activityLogService.logCreate(
        'authUser',
        userId,
        {
          email,
          fullName,
          role: payload.role || 'customer',
          status: 'ACTIVE',
          verified: 'true',
          provider: 'local',
        },
        { ip, userAgent, actionedBy: userId, device },
        session,
      );

      await session.commitTransaction();

      // Queue verification email
      try {
        const verificationCode =
          this.authUtilsService.generateVerificationCode();
        const { VERIFICATION } = AUTH_CONFIG.TOKEN_EXPIRY;
        const expiresAt = new Date(
          Date.now() + this.parseExpiryToSeconds(VERIFICATION) * 1000,
        );

        // Store verification code in Redis
        const verificationKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.VERIFICATION_TOKEN}:${email}`;
        const ttlSeconds = Math.floor(
          (expiresAt.getTime() - Date.now()) / 1000,
        );

        await this.redisService.set(
          verificationKey,
          {
            code: verificationCode,
            userId: userId,
            email: email,
            expiresAt: expiresAt.toISOString(),
          },
          ttlSeconds,
        );

        // Create email history record
        const emailDocs = await this.emailHistoryModel.create(
          [
            {
              authId: userId,
              emailTo: email,
              emailType: 'verification',
              subject: 'Verify your email address',
              messageId: `verify-init-${userId}-${Date.now()}`,
              emailStatus: 'pending',
              ipAddress: ip,
              userAgent: userAgent,
            },
          ],
          { session: null },
        ); // Use null or wait until after transaction

        await this.authUserModel.findByIdAndUpdate(
          userId,
          {
            $push: {
              emailHistory: { $each: emailDocs.map((d) => d._id), $slice: -50 },
            },
          },
          { session: null },
        );

        await this.emailQueueService.sendVerificationEmail(
          email,
          fullName,
          verificationCode,
          userId,
        );
        this.customLogger.log(
          `User registered successfully: ${email}, verification email queued`,
          'AuthService',
        );
      } catch (error) {
        this.customLogger.error(
          `Failed to queue verification email for ${email}`,
          error instanceof Error ? error.stack : undefined,
          'AuthService',
        );
        console.error('Failed to queue verification email:', error);
      }
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    const createdUser = await this.authUserModel
      .findOne(this.getEmailQuery(email))
      .lean();
    if (!createdUser) {
      throw AppError.internalServerError(
        'Failed to retrieve user after creation',
      );
    }

    return {
      user: {
        id: createdUser._id.toString(),
        email: createdUser.email,
        fullName: createdUser.fullName,
        role: createdUser.role,
        verified: createdUser.verified,
      },
    };
  }

  /**
   * Verify user email with verification code
   */
  async verifyEmail(
    email: string,
    code: string,
    meta: { ip: string; userAgent: string },
  ): Promise<{ message: string }> {
    const { ip, userAgent } = meta;

    this.customLogger.log(
      `Email verification attempt for: ${email}`,
      'AuthService',
    );
    const verificationKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.VERIFICATION_TOKEN}:${email}`;

    // Get verification data from Redis
    const verificationData = await this.redisService.get<{
      code: string;
      userId: string;
      email: string;
      expiresAt: string;
    }>(verificationKey);

    if (!verificationData) {
      this.customLogger.warn(
        `Verification failed: Code expired or invalid for ${email}`,
        'AuthService',
      );
      throw AppError.badRequest(
        'Verification code expired or invalid. Please request a new code.',
      );
    }

    // Validate code
    if (verificationData.code !== code) {
      this.customLogger.warn(
        `Verification failed: Invalid code for ${email}`,
        'AuthService',
      );
      throw AppError.badRequest('Invalid verification code');
    }

    // Find user
    const user = await this.authUserModel.findOne(this.getEmailQuery(email));

    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.verified) {
      throw AppError.badRequest('Email already verified');
    }

    // Update user as verified
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      await this.authUserModel.findByIdAndUpdate(
        user._id,
        { verified: true },
        { session },
      );

      // Log verification activity
      await this.activityLogService.logCustomEvent(
        'authUser',
        user._id.toString(),
        'profile_update',
        { ip, userAgent, actionedBy: user._id.toString() },
        [
          {
            fieldName: 'verified',
            oldValue: 'false',
            newValue: 'true',
          },
        ],
        session,
      );

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    // Delete verification code from Redis
    await this.redisService.del(verificationKey);

    // Queue welcome email for async processing
    try {
      await this.emailQueueService.sendWelcomeEmail(
        email,
        user.fullName,
        user._id.toString(),
      );
      this.customLogger.log(
        `Email verified successfully for: ${email}, welcome email queued`,
        'AuthService',
      );
    } catch (error) {
      this.customLogger.error(
        `Verification successful but failed to queue welcome email for ${email}`,
        error instanceof Error ? error.stack : undefined,
        'AuthService',
      );
      console.error('Failed to queue welcome email:', error);
      // Don't throw, verification is successful
    }

    return { message: 'Email verified successfully' };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(
    email: string,
    meta: { ip: string; userAgent: string },
  ): Promise<{ message: string }> {
    const { ip, userAgent } = meta;
    const { VERIFICATION } = AUTH_CONFIG.TOKEN_EXPIRY;

    this.customLogger.log(
      `Resend verification email requested for: ${email}`,
      'AuthService',
    );

    // Check rate limiting
    await this.authUtilsService.checkRateLimit(
      `resend:verification:${email}`,
      3, // Max 3 attempts
      15 * 60 * 1000, // 15 minutes
    );

    // Find user
    const user = await this.authUserModel.findOne(this.getEmailQuery(email));

    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (user.verified) {
      throw AppError.badRequest('Email already verified');
    }

    // Generate new verification code
    const verificationCode = this.authUtilsService.generateVerificationCode();
    const expiresAt = new Date(
      Date.now() + this.parseExpiryToSeconds(VERIFICATION) * 1000,
    );

    // Store new verification code in Redis
    const verificationKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.VERIFICATION_TOKEN}:${email}`;
    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    await this.redisService.set(
      verificationKey,
      {
        code: verificationCode,
        userId: user._id.toString(),
        email: user.email,
        expiresAt: expiresAt.toISOString(),
      },
      ttlSeconds,
    );

    // Create new email history record
    const emailDoc = await this.emailHistoryModel.create({
      authId: user._id.toString(),
      emailTo: email,
      emailType: 'verification',
      subject: 'Verify your email address',
      messageId: `verify-resend-${user._id.toString()}-${Date.now()}`,
      emailStatus: 'pending',
      ipAddress: ip,
      userAgent: userAgent,
    });

    await this.authUserModel.findByIdAndUpdate(user._id, {
      $push: { emailHistory: { $each: [emailDoc._id], $slice: -50 } },
    });

    // Queue verification email for async processing
    try {
      await this.emailQueueService.sendVerificationEmail(
        email,
        user.fullName,
        verificationCode,
        user._id.toString(),
      );
    } catch (error) {
      console.error('Failed to queue verification email:', error);
      // Update email history status to 'failed'
      await this.emailHistoryModel.updateMany(
        {
          authId: user._id.toString(),
          emailType: 'verification',
          emailStatus: 'pending',
        },
        {
          emailStatus: 'failed',
          errorMessage:
            error instanceof Error ? error.message : 'Failed to queue email',
        },
      );
      throw AppError.badRequest('Failed to send verification email');
    }

    return { message: 'Verification email sent successfully' };
  }

  async login(
    payload: { email: string; password: string },
    meta: { ip: string; userAgent: string; device?: string },
  ): Promise<ILoginResponse> {
    const { email, password } = payload;
    const { ip, userAgent, device } = meta;

    const { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } = AUTH_CONFIG.RATE_LIMIT;
    const { MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS } =
      AUTH_CONFIG.ACCOUNT_LOCKOUT;

    // Rate limiting
    await Promise.all([
      this.authUtilsService.checkRateLimit(
        `login:email:${email}`,
        LOGIN_MAX_ATTEMPTS,
        LOGIN_WINDOW_MS,
      ),
      this.authUtilsService.checkRateLimit(
        `login:ip:${ip}`,
        LOGIN_MAX_ATTEMPTS,
        LOGIN_WINDOW_MS,
      ),
    ]);

    // Fetch user with security data in single optimized query
    const user = await this.authUserModel
      .findOne(this.getEmailQuery(email))
      .lean();

    // Also get security data separately
    let security = null;
    if (user) {
      security = await this.authSecurityModel
        .findOne({ authId: user._id.toString() })
        .lean();
    }

    // Generic error message to prevent user enumeration
    const invalidCredentialsError = AppError.unauthorized(
      'Invalid email or password',
    );

    // CRITICAL: Timing attack prevention
    // Always run argon2.verify even if user doesn't exist
    // This ensures consistent response time regardless of user existence
    const fakePasswordHash =
      '$argon2id$v=19$m=65536,t=3,p=4$Jv/w2U0+5z9jVqE3R8w6RQ$7Z4wV1a4Z7wV1a4Z7wV1a4Z7wV1a4Z7wV1a4Z7wV1a4';

    if (!user) {
      // Run fake argon2 to prevent timing attacks (~200ms)
      await argon2.verify(fakePasswordHash, password).catch(() => {});

      // Log failed attempt (fire-and-forget)
      void this.logLoginAttempt({
        authId: null,
        ip,
        userAgent,
        device,
        success: false,
        failureReason: 'user_not_found',
      });

      throw invalidCredentialsError;
    }

    const userId = user._id.toString();

    // Check OAuth provider
    if (user.provider !== 'local') {
      throw AppError.badRequest(
        `Please login using ${user.provider} authentication`,
      );
    }

    // Check account status
    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') {
      void this.logLoginAttempt({
        authId: userId,
        ip,
        userAgent,
        device,
        success: false,
        failureReason: `account_${user.status.toLowerCase()}`,
      });
      throw AppError.forbidden(
        `Your account has been ${user.status.toLowerCase()}. Please contact support.`,
      );
    }

    if (user.status === 'DELETED' || user.status === 'INACTIVE') {
      // Run argon2 to maintain consistent timing
      await argon2.verify(user.password, password).catch(() => {});
      throw invalidCredentialsError;
    }

    if (!user.verified) {
      // Run argon2 to maintain consistent timing
      await argon2.verify(user.password, password).catch(() => {});
      throw AppError.forbidden('Please verify your email before logging in.');
    }

    // Check account lockout
    if (security?.lockExpiresAt && new Date() < security.lockExpiresAt) {
      const remainingTime = Math.ceil(
        (security.lockExpiresAt.getTime() - Date.now()) / 1000 / 60,
      );
      void this.logLoginAttempt({
        authId: userId,
        ip,
        userAgent,
        device,
        success: false,
        failureReason: 'account_locked',
        attemptNumber: security.failedAttempts + 1,
      });
      throw AppError.forbidden(
        `Account is temporarily locked. Please try again in ${remainingTime} minutes.`,
      );
    }

    // Verify password (argon2 uses constant-time comparison internally)
    const isPasswordValid = await argon2
      .verify(user.password, password)
      .catch(() => false);

    if (!isPasswordValid) {
      await this.handleFailedLoginAttempt(
        userId,
        security?.failedAttempts || 0,
        MAX_FAILED_ATTEMPTS,
        LOCKOUT_DURATION_MS,
        { ip, userAgent, device },
      );
      throw invalidCredentialsError;
    }

    // Distributed lock to prevent concurrent login race conditions
    const lockKey = `${config.redis_cache_key_prefix}:lock:login:${userId}`;
    const lockAcquired = await this.redisService.setNX(lockKey, '1', 5); // 5 second TTL

    if (!lockAcquired) {
      throw AppError.conflict(
        'Another login is in progress. Please try again in a moment.',
      );
    }

    try {
      // Generate JTI FIRST (cryptographically secure)
      const jti: string = this.authUtilsService.generateSecureId();

      // Create access token (stateless, minimal payload - no email)
      const accessToken: string = this.authUtilsService.createAccessToken({
        userId,
        role: user.role as unknown as UserRole,
        tokenVersion: user.tokenVersion, // Include tokenVersion for hybrid JWT validation
      });

      // Create refresh token with JTI embedded
      const refreshToken: string = this.authUtilsService.createRefreshToken(
        { userId },
        jti,
      );

      // Hash the refresh token for secure storage (never store raw tokens)
      const tokenHash: string = this.authUtilsService.hashToken(refreshToken);

      // Calculate TTL
      const refreshTokenTTL = this.parseExpiryToSeconds(
        AUTH_CONFIG.TOKEN_EXPIRY.REFRESH,
      );

      // Redis key with proper naming convention
      const refreshTokenKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.REFRESH_TOKEN}:${userId}:${jti}`;

      // Stored token data (with hash, not raw token)
      const storedTokenData: IStoredRefreshToken = {
        userId,
        jti,
        tokenHash, // Store hash, not raw token
        ip,
        userAgent,
        device,
        createdAt: new Date().toISOString(),
      };

      // Execute critical Redis operations with detailed error handling and rollback
      try {
        // CRITICAL: Store refresh token hash in Redis
        await this.redisService.set(
          refreshTokenKey,
          storedTokenData,
          refreshTokenTTL,
        );
      } catch (error) {
        console.error('Failed to store refresh token in Redis:', {
          userId,
          jti,
          error: error instanceof Error ? error.message : String(error),
        });
        throw AppError.serviceUnavailable(
          'Authentication service temporarily unavailable. Please try again.',
        );
      }

      try {
        // CRITICAL: Track session in user's session list
        await this.addUserSession(userId, jti, refreshTokenTTL);
      } catch (error) {
        console.error('Failed to add user session to Redis:', {
          userId,
          jti,
          error: error instanceof Error ? error.message : String(error),
        });

        // Rollback: Remove the refresh token we just stored
        await this.redisService.del(refreshTokenKey).catch((rollbackError) => {
          console.error('CRITICAL: Failed to rollback refresh token:', {
            userId,
            jti,
            error:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
          });
        });

        throw AppError.serviceUnavailable(
          'Authentication service temporarily unavailable. Please try again.',
        );
      }

      // NON-CRITICAL: Enforce max devices (log but don't fail login)
      try {
        await this.enforceMaxDevices(
          userId,
          AUTH_CONFIG.SESSION.MAX_DEVICES_PER_USER,
        );
      } catch (error) {
        console.error('Failed to enforce max devices (non-critical):', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue - login still succeeds
      }

      // NON-CRITICAL: DB operations (fire-and-forget with detailed logging)
      void Promise.allSettled([
        security
          ? this.authSecurityModel.findByIdAndUpdate(security._id, {
              failedAttempts: 0,
              lastFailedAt: null,
              lockExpiresAt: null,
            })
          : Promise.resolve(),
        this.logLoginAttempt({
          authId: userId,
          ip,
          userAgent,
          device,
          success: true,
        }),
      ]).then((results) => {
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('Non-critical login post-process failed:', result);
          }
        });
      });

      return {
        accessToken,
        refreshToken,
        user: {
          id: userId,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          verified: user.verified,
        },
        expiresIn: this.parseExpiryToSeconds(AUTH_CONFIG.TOKEN_EXPIRY.ACCESS),
      };
    } finally {
      // Always release the lock
      await this.redisService.del(lockKey);
    }
  }

  /**
   * Refresh access token using refresh token
   * Implements token rotation for security
   */
  async refreshToken(
    refreshToken: string,
    meta: { ip: string; userAgent: string; device?: string },
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { ip, userAgent, device } = meta;

    // Verify and decode refresh token
    let decoded: { userId: string; jti: string };
    try {
      const payload = this.authUtilsService.verifyRefreshToken(refreshToken);

      // JTI comes from JWT standard claims (set via jwtid option)
      if (!payload.jti) {
        throw new Error('Missing JTI in token');
      }

      decoded = {
        userId: payload.userId,
        jti: payload.jti,
      };
    } catch {
      throw AppError.unauthorized('Invalid or expired refresh token');
    }

    const { userId, jti } = decoded;
    if (!userId || !jti) {
      throw AppError.unauthorized('Invalid refresh token payload');
    }

    // Get stored token data from Redis
    const refreshTokenKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.REFRESH_TOKEN}:${userId}:${jti}`;
    const storedData =
      await this.redisService.get<IStoredRefreshToken>(refreshTokenKey);

    if (!storedData) {
      // Token not found - possibly already rotated or revoked
      // This could indicate a replay attack - revoke all user tokens
      await this.revokeAllUserTokens(userId);
      throw AppError.unauthorized(
        'Refresh token has been revoked. Please login again.',
      );
    }

    // Validate token hash (ensures token hasn't been tampered with)
    const tokenHash: string = this.authUtilsService.hashToken(refreshToken);
    if (storedData.tokenHash !== tokenHash) {
      // Token mismatch - potential attack, revoke all tokens
      await this.revokeAllUserTokens(userId);
      throw AppError.unauthorized('Invalid refresh token');
    }

    // Fetch user to get current role (may have changed)
    const user = await this.authUserModel
      .findById(userId)
      .select('id role status tokenVersion')
      .lean();

    if (!user || user.status !== 'ACTIVE') {
      await this.revokeAllUserTokens(userId);
      throw AppError.unauthorized('User account is not active');
    }

    // TOKEN ROTATION: Generate new JTI for new refresh token
    const newJti: string = this.authUtilsService.generateSecureId();

    // Create new tokens
    const newAccessToken: string = this.authUtilsService.createAccessToken({
      userId: user._id.toString(),
      role: user.role as unknown as UserRole,
      tokenVersion: user.tokenVersion, // Include tokenVersion for hybrid JWT validation
    });

    const newRefreshToken: string = this.authUtilsService.createRefreshToken(
      { userId: user._id.toString() },
      newJti,
    );

    const newTokenHash: string =
      this.authUtilsService.hashToken(newRefreshToken);
    const refreshTokenTTL = this.parseExpiryToSeconds(
      AUTH_CONFIG.TOKEN_EXPIRY.REFRESH,
    );

    const newRefreshTokenKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.REFRESH_TOKEN}:${userId}:${newJti}`;

    const newStoredData: IStoredRefreshToken = {
      userId,
      jti: newJti,
      tokenHash: newTokenHash,
      ip,
      userAgent,
      device,
      createdAt: new Date().toISOString(),
      rotatedFrom: jti, // Track rotation chain
    };

    // Atomic rotation: delete old token and create new one
    await Promise.all([
      // Delete old refresh token
      this.redisService.del(refreshTokenKey),
      // Remove old JTI from session list
      this.removeUserSession(userId, jti),
      // Store new refresh token
      this.redisService.set(newRefreshTokenKey, newStoredData, refreshTokenTTL),
      // Add new JTI to session list
      this.addUserSession(userId, newJti, refreshTokenTTL),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.parseExpiryToSeconds(AUTH_CONFIG.TOKEN_EXPIRY.ACCESS),
    };
  }

  /**
   * Logout user by revoking their refresh token
   */
  async logout(
    refreshToken: string,
    userId: string,
  ): Promise<{ message: string }> {
    // Verify refresh token
    let decoded;
    try {
      decoded = this.authUtilsService.verifyRefreshToken(refreshToken);
    } catch {
      // Token already invalid, just return success
      return { message: 'Logged out successfully' };
    }

    if (decoded.userId !== userId) {
      throw AppError.unauthorized('Invalid token');
    }

    const { jti } = decoded;
    if (jti) {
      const refreshTokenKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.REFRESH_TOKEN}:${userId}:${jti}`;

      await Promise.all([
        this.redisService.del(refreshTokenKey),
        this.removeUserSession(userId, jti),
      ]);
    }

    return { message: 'Logged out successfully' };
  }

  /**
   * Logout from all devices by revoking all refresh tokens
   */
  async logoutAllDevices(userId: string): Promise<{ message: string }> {
    await this.revokeAllUserTokens(userId);
    // Increment tokenVersion to immediately invalidate all access tokens
    await this.incrementTokenVersion(userId);
    return { message: 'Logged out from all devices successfully' };
  }

  async invalidateUserSessions(userId: string): Promise<void> {
    await this.revokeAllUserTokens(userId);
    await this.incrementTokenVersion(userId);
  }

  /**
   * Add a session (JTI) to user's session list
   */
  private async addUserSession(
    userId: string,
    jti: string,
    ttl: number,
  ): Promise<void> {
    const userSessionsKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.USER_SESSIONS}:${userId}`;

    // Get current sessions
    const sessions =
      (await this.redisService.get<string[]>(userSessionsKey)) || [];

    // Add new session
    sessions.push(jti);

    // Store updated sessions
    await this.redisService.set(userSessionsKey, sessions, ttl);
  }

  /**
   * Remove a session from user's session list
   */
  private async removeUserSession(userId: string, jti: string): Promise<void> {
    const userSessionsKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.USER_SESSIONS}:${userId}`;

    const sessions =
      (await this.redisService.get<string[]>(userSessionsKey)) || [];
    const updatedSessions = sessions.filter((s) => s !== jti);

    if (updatedSessions.length > 0) {
      const ttl = this.parseExpiryToSeconds(AUTH_CONFIG.TOKEN_EXPIRY.REFRESH);
      await this.redisService.set(userSessionsKey, updatedSessions, ttl);
    } else {
      await this.redisService.del(userSessionsKey);
    }
  }

  /**
   * Enforce maximum devices per user
   * Removes oldest sessions when limit exceeded
   */
  private async enforceMaxDevices(
    userId: string,
    maxDevices: number,
  ): Promise<void> {
    const userSessionsKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.USER_SESSIONS}:${userId}`;

    const sessions =
      (await this.redisService.get<string[]>(userSessionsKey)) || [];

    if (sessions.length <= maxDevices) {
      return;
    }

    // Remove oldest sessions (first in list)
    const sessionsToRemove = sessions.slice(
      0,
      sessions.length - maxDevices + 1,
    );

    await Promise.all(
      sessionsToRemove.map(async (jti) => {
        const tokenKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.REFRESH_TOKEN}:${userId}:${jti}`;
        await this.redisService.del(tokenKey);
      }),
    );

    // Keep only the most recent sessions
    const updatedSessions = sessions.slice(sessions.length - maxDevices + 1);
    const ttl = this.parseExpiryToSeconds(AUTH_CONFIG.TOKEN_EXPIRY.REFRESH);
    await this.redisService.set(userSessionsKey, updatedSessions, ttl);
  }

  /**
   * Revoke all refresh tokens for a user (security measure)
   */
  private async revokeAllUserTokens(userId: string): Promise<void> {
    const userSessionsKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.USER_SESSIONS}:${userId}`;

    const sessions =
      (await this.redisService.get<string[]>(userSessionsKey)) || [];

    // Delete all refresh tokens
    await Promise.all([
      ...sessions.map((jti) => {
        const tokenKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.REFRESH_TOKEN}:${userId}:${jti}`;
        return this.redisService.del(tokenKey);
      }),
      this.redisService.del(userSessionsKey),
    ]);
  }

  /**
   * Handle failed login attempt with account lockout
   */
  private async handleFailedLoginAttempt(
    userId: string,
    currentFailedAttempts: number,
    maxAttempts: number,
    lockoutDuration: number,
    meta: { ip: string; userAgent: string; device?: string },
  ): Promise<void> {
    const newFailedAttempts = currentFailedAttempts + 1;
    const shouldLock = newFailedAttempts >= maxAttempts;

    const updateData: any = {
      failedAttempts: newFailedAttempts,
      lastFailedAt: new Date(),
    };

    if (shouldLock) {
      updateData.lockExpiresAt = new Date(Date.now() + lockoutDuration);
    }

    await Promise.all([
      this.authSecurityModel.findOneAndUpdate({ authId: userId }, updateData),
      this.logLoginAttempt({
        authId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        device: meta.device,
        success: false,
        failureReason: shouldLock ? 'account_locked' : 'invalid_password',
        attemptNumber: newFailedAttempts,
      }),
    ]);

    // On account lock, increment tokenVersion to immediately invalidate all access tokens
    if (shouldLock) {
      await this.incrementTokenVersion(userId);
    }
  }

  /**
   * Log login attempt (fire-and-forget for non-blocking writes)
   */
  private logLoginAttempt(data: {
    authId: string | null;
    ip: string;
    userAgent: string;
    device?: string;
    success: boolean;
    failureReason?: string;
    attemptNumber?: number;
    isSuspicious?: boolean;
  }): Promise<void> {
    if (!data.authId) {
      return Promise.resolve();
    }

    return this.loginHistoryModel
      .create({
        authId: data.authId,
        ipAddress: data.ip,
        userAgent: data.userAgent,
        deviceId: data.device,
        action: 'login',
        success: data.success,
        failureReason: data.failureReason,
        attemptNumber: data.attemptNumber || 1,
        isSuspicious: data.isSuspicious || false,
      })
      .then(async (doc) => {
        await this.authUserModel
          .findByIdAndUpdate(data.authId, {
            $push: { loginHistory: { $each: [doc._id], $slice: -50 } },
          })
          .catch((err) =>
            console.error('Failed to update user login history:', err),
          );
        return undefined;
      })
      .catch((error) => {
        console.error('Failed to log login attempt:', error);
      });
  }

  /**
   * Parse token expiry string to seconds
   */
  private parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])?$/);
    if (!match) {
      return 3600;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      default:
        return value;
    }
  }

  /**
   * Increment token version for a user to immediately invalidate all access tokens.
   * Called on security-critical events: password change, role change, admin block, force logout.
   * Clears Redis cache to ensure AuthGuard will fetch new version from DB.
   *
   * @param userId - The user whose token version to increment
   */
  async incrementTokenVersion(userId: string): Promise<void> {
    // Increment in database
    await this.authUserModel.findByIdAndUpdate(userId, {
      $inc: { tokenVersion: 1 },
    });

    // Invalidate Redis cache so next guard check fetches new version
    const cacheKey = `${config.redis_cache_key_prefix}:token_version:${userId}`;
    await this.redisService.del(cacheKey);

    this.customLogger.log(
      `Token version incremented for user ${userId}`,
      'AuthService.incrementTokenVersion',
    );
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    meta: { ip: string; userAgent: string },
  ): Promise<{ message: string }> {
    const { ip, userAgent } = meta;

    this.customLogger.log(
      `Password change attempt for user: ${userId}`,
      'AuthService',
    );

    // Find user
    const user = await this.authUserModel.findById(userId);

    if (!user) {
      throw AppError.notFound('User not found');
    }

    // Check if user is using OAuth provider
    if (user.provider !== 'local') {
      throw AppError.badRequest(
        `This account uses ${user.provider} authentication. Password cannot be changed.`,
      );
    }

    // Verify old password
    const isOldPasswordValid = await argon2
      .verify(user.password, oldPassword)
      .catch(() => false);

    if (!isOldPasswordValid) {
      this.customLogger.warn(
        `Password change failed: Invalid old password for user ${userId}`,
        'AuthService',
      );
      throw AppError.badRequest('Current password is incorrect');
    }

    // Validate new password strength
    if (!this.authUtilsService.validatePassword(newPassword)) {
      throw AppError.badRequest('Password does not meet security requirements');
    }

    // Check if new password is same as old password
    const isSameAsOld = await argon2
      .verify(user.password, newPassword)
      .catch(() => false);
    if (isSameAsOld) {
      throw AppError.badRequest(
        'New password must be different from current password',
      );
    }

    // Hash new password
    const hashedPassword = await argon2.hash(newPassword);

    // Update password in transaction
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      await this.authUserModel.findByIdAndUpdate(
        userId,
        { password: hashedPassword },
        { session },
      );

      // Log password change activity
      await this.activityLogService.logCustomEvent(
        'authUser',
        userId,
        'password_change',
        { ip, userAgent, actionedBy: userId },
        [
          {
            fieldName: 'password',
            oldValue: 'encrypted',
            newValue: 'encrypted',
          },
        ],
        session,
      );

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    // Increment token version to invalidate all existing tokens
    await this.incrementTokenVersion(userId);

    this.customLogger.log(
      `Password changed successfully for user ${userId}`,
      'AuthService',
    );

    return {
      message:
        'Password changed successfully. Please login again with your new password.',
    };
  }

  /**
   * Forgot password - Send OTP to user's email
   */
  async forgotPassword(
    email: string,
    meta: { ip: string; userAgent: string },
  ): Promise<{ message: string }> {
    const { ip, userAgent } = meta;

    this.customLogger.log(
      `Password reset request for email: ${email}`,
      'AuthService',
    );

    const { PASSWORD_RESET_MAX_ATTEMPTS, PASSWORD_RESET_WINDOW_MS } =
      AUTH_CONFIG.RATE_LIMIT;
    const { PASSWORD_RESET } = AUTH_CONFIG.TOKEN_EXPIRY;

    // Check rate limiting
    await this.authUtilsService.checkRateLimit(
      `password_reset:${email}`,
      PASSWORD_RESET_MAX_ATTEMPTS,
      PASSWORD_RESET_WINDOW_MS,
    );

    // Find user by email
    const user = await this.authUserModel.findOne(this.getEmailQuery(email));

    if (!user) {
      // Don't reveal if user exists or not
      this.customLogger.warn(
        `Password reset requested for non-existent email: ${email}`,
        'AuthService',
      );
      // Return success message to prevent user enumeration
      return {
        message:
          'If an account with that email exists, a password reset OTP has been sent.',
      };
    }

    // Check if user is using OAuth provider
    if (user.provider !== 'local') {
      throw AppError.badRequest(
        `This account uses ${user.provider} authentication. Please login using ${user.provider}.`,
      );
    }

    // Generate OTP
    const otp = this.authUtilsService.generateVerificationCode();
    const expiresAt = new Date(
      Date.now() + this.parseExpiryToSeconds(PASSWORD_RESET) * 1000,
    );

    // Store OTP in Redis with expiry
    const resetKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.PASSWORD_RESET_TOKEN}:${email}`;
    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    await this.redisService.set(
      resetKey,
      {
        otp,
        userId: user._id.toString(),
        email,
        expiresAt: expiresAt.toISOString(),
      },
      ttlSeconds,
    );

    // Create email history record
    const emailDoc = await this.emailHistoryModel.create({
      authId: user._id.toString(),
      emailTo: email,
      emailType: 'password_reset',
      subject: 'Reset your password',
      messageId: `reset-${user._id.toString()}-${Date.now()}`,
      emailStatus: 'pending',
      ipAddress: ip,
      userAgent: userAgent,
    });

    await this.authUserModel.findByIdAndUpdate(user._id, {
      $push: { emailHistory: { $each: [emailDoc._id], $slice: -50 } },
    });

    // Send password reset email
    try {
      await this.emailQueueService.sendPasswordResetEmail(
        email,
        user.fullName,
        otp,
        user._id.toString(),
      );

      this.customLogger.log(
        `Password reset OTP sent to: ${email}`,
        'AuthService',
      );
    } catch (error) {
      this.customLogger.error(
        `Failed to send password reset email to ${email}`,
        error instanceof Error ? error.stack : undefined,
        'AuthService',
      );

      // Update email history status to 'failed'
      await this.emailHistoryModel.updateOne(
        {
          authId: user._id.toString(),
          emailType: 'password_reset',
          emailStatus: 'pending',
        },
        {
          emailStatus: 'failed',
          errorMessage:
            error instanceof Error ? error.message : 'Failed to send email',
        },
      );

      throw AppError.badRequest('Failed to send password reset email');
    }

    return {
      message:
        'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  /**
   * Verify password reset OTP and return a reset token
   */
  async verifyResetOtp(
    email: string,
    otp: string,
  ): Promise<{ message: string; valid: boolean; resetToken: string }> {
    this.customLogger.log(
      `OTP verification attempt for password reset: ${email}`,
      'AuthService',
    );

    const resetKey = `${config.redis_cache_key_prefix}:${AUTH_CONFIG.CACHE_PREFIXES.PASSWORD_RESET_TOKEN}:${email}`;

    // Get OTP data from Redis
    const resetData = await this.redisService.get<{
      otp: string;
      userId: string;
      email: string;
      expiresAt: string;
    }>(resetKey);

    if (!resetData) {
      this.customLogger.warn(
        `Password reset OTP expired or not found for ${email}`,
        'AuthService',
      );
      throw AppError.badRequest(
        'OTP expired or invalid. Please request a new password reset.',
      );
    }

    // Validate OTP
    if (resetData.otp !== otp) {
      this.customLogger.warn(
        `Invalid password reset OTP for ${email}`,
        'AuthService',
      );
      throw AppError.badRequest('Invalid OTP');
    }

    // Generate reset token (15 minutes validity)
    const resetToken = this.authUtilsService.generateSecureId();
    const resetTokenKey = `${config.redis_cache_key_prefix}:reset_token:${resetToken}`;
    const resetTokenTTL = 15 * 60; // 15 minutes in seconds

    // Store reset token in Redis
    await this.redisService.set(
      resetTokenKey,
      {
        userId: resetData.userId,
        email: resetData.email,
        createdAt: new Date().toISOString(),
      },
      resetTokenTTL,
    );

    // Delete the OTP as it's no longer needed
    await this.redisService.del(resetKey);

    this.customLogger.log(
      `Password reset OTP verified successfully for ${email}, reset token issued`,
      'AuthService',
    );

    return {
      message: 'OTP verified successfully. You can now reset your password.',
      valid: true,
      resetToken,
    };
  }

  /**
   * Reset password with reset token
   */
  async resetPassword(
    resetToken: string,
    newPassword: string,
    meta: { ip: string; userAgent: string },
  ): Promise<{ message: string }> {
    const { ip, userAgent } = meta;

    this.customLogger.log(`Password reset attempt with token`, 'AuthService');

    // Verify reset token
    const resetTokenKey = `${config.redis_cache_key_prefix}:reset_token:${resetToken}`;

    const tokenData = await this.redisService.get<{
      userId: string;
      email: string;
      createdAt: string;
    }>(resetTokenKey);

    if (!tokenData) {
      this.customLogger.warn(`Invalid or expired reset token`, 'AuthService');
      throw AppError.badRequest(
        'Reset token expired or invalid. Please verify your OTP again.',
      );
    }

    // Validate new password strength
    if (!this.authUtilsService.validatePassword(newPassword)) {
      throw AppError.badRequest('Password does not meet security requirements');
    }

    // Find user
    const user = await this.authUserModel.findById(tokenData.userId);

    if (!user) {
      this.customLogger.warn(
        `User not found for reset token: ${tokenData.userId}`,
        'AuthService',
      );
      throw AppError.notFound('User not found');
    }

    // Hash new password
    const hashedPassword = await argon2.hash(newPassword);

    // Update password in transaction
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      await this.authUserModel.findByIdAndUpdate(
        user._id,
        { password: hashedPassword },
        { session },
      );

      // Log password change activity
      await this.activityLogService.logCustomEvent(
        'authUser',
        user._id.toString(),
        'password_change',
        { ip, userAgent, actionedBy: user._id.toString() },
        [
          {
            fieldName: 'password',
            oldValue: 'encrypted',
            newValue: 'encrypted',
          },
        ],
        session,
      );

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    // Delete reset token from Redis (single use)
    await this.redisService.del(resetTokenKey);

    // Increment token version to invalidate all existing tokens
    await this.incrementTokenVersion(user._id.toString());

    this.customLogger.log(
      `Password reset successful for ${tokenData.email}`,
      'AuthService',
    );

    return {
      message:
        'Password reset successful. Please login with your new password.',
    };
  }
}
