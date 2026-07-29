import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Query,
  Res,
  Logger,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './services/google-oauth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import {
  ForgotPasswordDto,
  VerifyResetOtpDto,
  ResetPasswordDto,
} from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto, ResendVerificationDto } from './dto/verify-email.dto';
import {
  GoogleOAuthInitDto,
  GoogleOAuthCallbackDto,
} from './dto/google-oauth.dto';
import {
  LoginDto,
  LogoutAllDto,
  LogoutDto,
  RefreshTokenDto,
} from './dto/session.dto';
import type { Request, Response } from 'express';
import { CustomLoggerService } from '../../common/services/custom-logger.service';
import { AuthGuard } from '../../common/guards/auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly customLogger: CustomLoggerService,
  ) {}

    @ApiOperation({
    summary: 'Register a customer account',
    description:
      'Creates a local customer account, stores security metadata, and queues an email verification code.',
  })
  @ApiCreatedResponse({
    description: 'Registration completed and verification email queued.',
    schema: {
      example: {
        statusCode: 201,
        message: 'Success',
        data: {
          success: true,
          message:
            'Registration successful. Please verify your email to login.',
          data: {
            user: {
              id: '65f1c2a6e5b9a2d8a4f2c111',
              email: 'jordan@example.com',
              fullName: 'Jordan Davis',
              role: 'customer',
              verified: false,
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid registration payload.' })
  @ApiConflictResponse({ description: 'Email address already exists.' })
  @ApiForbiddenResponse({
    description: 'Public registration as an administrator is blocked.',
  })
  @Post('register')
  async create(@Body() payload: CreateAuthDto, @Req() req: Request) {
    this.customLogger.log(
      `Registration attempt for email: ${payload.email}`,
      'AuthController',
    );
    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      device:
        (Array.isArray(req.headers['x-device'])
          ? req.headers['x-device'][0]
          : req.headers['x-device']) ||
        (Array.isArray(req.headers['x-device-id'])
          ? req.headers['x-device-id'][0]
          : req.headers['x-device-id']) ||
        (Array.isArray(req.headers['sec-ch-ua-platform'])
          ? req.headers['sec-ch-ua-platform'][0]
          : req.headers['sec-ch-ua-platform']),
    };
    const result = await this.authService.create(payload, meta);

    return {
      success: true,
      message: 'Registration successful. Please verify your email to login.',
      data: result,
    };
  }

  // ==========================================
  // Email Verification Endpoints
  // ==========================================

  @ApiOperation({
    summary: 'Verify account email',
    description:
      'Validates the six-character verification code sent during registration or resend.',
  })
  @ApiOkResponse({
    description: 'Email verified successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: { message: 'Email verified successfully' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Verification code is invalid, expired, or already used.',
  })
  @Post('verify-email')
  async verifyEmail(
    @Body() verifyEmailDto: VerifyEmailDto,
    @Req() req: Request,
  ) {
    this.customLogger.log(
      `Email verification attempt for: ${verifyEmailDto.email}`,
      'AuthController',
    );
    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    return this.authService.verifyEmail(
      verifyEmailDto.email,
      verifyEmailDto.code,
      meta,
    );
  }

  @ApiOperation({
    summary: 'Resend verification email',
    description: 'Sends a fresh verification code to an unverified account.',
  })
  @ApiOkResponse({
    description: 'Verification email sent successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: { message: 'Verification email sent successfully' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email is already verified or the resend request failed.',
  })
  @Post('resend-verification')
  async resendVerification(
    @Body() resendVerificationDto: ResendVerificationDto,
    @Req() req: Request,
  ) {
    this.customLogger.log(
      `Resend verification attempt for: ${resendVerificationDto.email}`,
      'AuthController',
    );
    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    return this.authService.resendVerificationEmail(
      resendVerificationDto.email,
      meta,
    );
  }

  // ==========================================
  // Password Reset Endpoints
  // ==========================================

  /**
   * Forgot Password - Send OTP to user's email
   * Rate limited to 3 requests per hour
   */
  @ApiOperation({
    summary: 'Request password reset OTP',
    description: 'Queues a password reset OTP email for a local account.',
  })
  @ApiOkResponse({ description: 'Password reset OTP request accepted.' })
  @ApiBadRequestResponse({ description: 'Invalid email or reset request.' })
  @Post('forgot-password')
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @Req() req: Request,
  ) {
    this.customLogger.log(
      `Forgot password request for email: ${forgotPasswordDto.email}`,
      'AuthController',
    );
    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };
    return this.authService.forgotPassword(forgotPasswordDto.email, meta);
  }

  /**
   * Verify password reset OTP
   */
  @ApiOperation({
    summary: 'Verify password reset OTP',
    description:
      'Checks the reset OTP and returns a reset token when the OTP is valid.',
  })
  @ApiOkResponse({ description: 'Password reset OTP verified successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid or expired reset OTP.' })
  @Post('verify-reset-otp')
  async verifyResetOtp(@Body() verifyOtpDto: VerifyResetOtpDto) {
    this.customLogger.log(
      `OTP verification request for password reset: ${verifyOtpDto.email}`,
      'AuthController',
    );
    return this.authService.verifyResetOtp(
      verifyOtpDto.email,
      verifyOtpDto.otp,
    );
  }

  /**
   * Reset password with reset token
   */
  @ApiOperation({
    summary: 'Reset password',
    description:
      'Sets a new account password using the reset token returned after OTP verification.',
  })
  @ApiOkResponse({ description: 'Password reset successfully.' })
  @ApiBadRequestResponse({
    description: 'Invalid reset token or password policy failure.',
  })
  @Post('reset-password')
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
    @Req() req: Request,
  ) {
    this.customLogger.log(
      `Password reset attempt with token`,
      'AuthController',
    );
    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };
    return this.authService.resetPassword(
      resetPasswordDto.resetToken,
      resetPasswordDto.newPassword,
      meta,
    );
  }

  // ==========================================
  // Google OAuth Endpoints
  // ==========================================

  /**
   * Initiate Google OAuth flow
   * Returns the Google authorization URL for the client to redirect to
   *
   * @example GET /auth/google
   * @example GET /auth/google?redirectUrl=http://localhost:3000/dashboard
   */
  @ApiOperation({
    summary: 'Start Google OAuth',
    description:
      'Generates a Google OAuth 2.0 authorization URL with PKCE and CSRF state protection.',
  })
  @ApiQuery({
    name: 'redirectUrl',
    required: false,
    description: 'Frontend URL to redirect to after browser OAuth callback.',
    example: 'https://app.kungfujew.com/dashboard',
  })
  @ApiOkResponse({
    description: 'Google authorization URL generated successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: {
          url: 'https://accounts.google.com/o/oauth2/v2/auth?...',
          state: 'c0b6e7d53a9f4f4c9d8f6c0f8c7d4b2a',
          message: 'Redirect to the provided URL to authenticate with Google',
        },
      },
    },
  })
  @Get('google')
  async googleOAuthInit(
    @Query() query: GoogleOAuthInitDto,
    @Req() req: Request,
  ) {
    this.customLogger.log(
      'Google OAuth initialization requested',
      'AuthController',
    );

    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    const { url, state } = await this.googleOAuthService.getAuthorizationUrl(
      meta,
      query.redirectUrl,
    );

    return {
      url,
      state,
      message: 'Redirect to the provided URL to authenticate with Google',
    };
  }

  /**
   * Google OAuth callback handler
   * This endpoint is called by Google after user authentication
   *
   * For browser-based flows, this redirects to the frontend
   * For API-based flows, returns JSON with tokens
   */
  @ApiOperation({
    summary: 'Handle Google OAuth browser callback',
    description:
      'Receives Google callback query parameters, validates state/code, and either redirects to the frontend with tokens or returns a JSON login payload.',
  })
  @ApiQuery({
    name: 'code',
    required: false,
    description: 'Authorization code returned by Google.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'State token originally generated by the OAuth init route.',
  })
  @ApiQuery({
    name: 'error',
    required: false,
    description: 'OAuth error code when Google rejects the authorization flow.',
  })
  @ApiQuery({
    name: 'error_description',
    required: false,
    description: 'Human-readable OAuth error details from Google.',
  })
  @ApiOkResponse({
    description:
      'OAuth callback processed. May return JSON or issue an HTTP redirect when redirectUrl is present.',
  })
  @ApiBadRequestResponse({ description: 'Missing or invalid OAuth callback.' })
  @Get('google/callback')
  async googleOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Req() req: Request,

    @Res({ passthrough: true }) res: Response,
  ) {
    // Handle OAuth errors
    if (error) {
      this.customLogger.warn(
        `Google OAuth error: ${error} - ${errorDescription}`,
        'AuthController',
      );
      Logger.warn(
        `Google OAuth error: ${error} - ${errorDescription}`,
        'AuthController',
      );

      // For browser redirect, you might want to redirect to an error page
      return {
        success: false,
        error,
        errorDescription,
        message: 'Google authentication failed',
      };
    }

    if (!code || !state) {
      return {
        success: false,
        error: 'missing_parameters',
        message: 'Missing authorization code or state parameter',
      };
    }

    this.customLogger.log('Google OAuth callback received', 'AuthController');
    Logger.log('Google OAuth callback received', 'AuthController');

    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      device:
        (Array.isArray(req.headers['x-device'])
          ? req.headers['x-device'][0]
          : req.headers['x-device']) ||
        (Array.isArray(req.headers['x-device-id'])
          ? req.headers['x-device-id'][0]
          : req.headers['x-device-id']) ||
        (Array.isArray(req.headers['sec-ch-ua-platform'])
          ? req.headers['sec-ch-ua-platform'][0]
          : req.headers['sec-ch-ua-platform']),
    };

    const result = await this.googleOAuthService.handleCallback(
      code,
      state,
      meta,
    );

    // If redirectUrl is provided, redirect to it with tokens as query params
    if (result.redirectUrl) {
      const redirectUrl = new URL(result.redirectUrl);
      redirectUrl.searchParams.set('access_token', result.accessToken);
      redirectUrl.searchParams.set('refresh_token', result.refreshToken);
      redirectUrl.searchParams.set('user_id', result.user.id);
      redirectUrl.searchParams.set('email', result.user.email);
      redirectUrl.searchParams.set('is_new_user', result.isNewUser.toString());

      return res.redirect(redirectUrl.toString());
    }

    // Otherwise return JSON response
    return {
      success: true,
      message: result.isNewUser
        ? 'Account created successfully via Google'
        : 'Signed in successfully via Google',
      data: result,
    };
  }

  /**
   * Alternative POST endpoint for Google OAuth callback
   * Useful for mobile apps or SPAs that handle the callback differently
   */
  @ApiOperation({
    summary: 'Handle Google OAuth callback for API clients',
    description:
      'Accepts authorization code and state in JSON for mobile apps or SPAs that do not use a browser redirect callback.',
  })
  @ApiOkResponse({
    description: 'Google OAuth login completed successfully.',
  })
  @ApiBadRequestResponse({ description: 'Invalid OAuth code or state.' })
  @Post('google/callback')
  async googleOAuthCallbackPost(
    @Body() body: GoogleOAuthCallbackDto,
    @Req() req: Request,
  ) {
    this.customLogger.log(
      'Google OAuth callback (POST) received',
      'AuthController',
    );

    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      device:
        (Array.isArray(req.headers['x-device'])
          ? req.headers['x-device'][0]
          : req.headers['x-device']) ||
        (Array.isArray(req.headers['x-device-id'])
          ? req.headers['x-device-id'][0]
          : req.headers['x-device-id']) ||
        (Array.isArray(req.headers['sec-ch-ua-platform'])
          ? req.headers['sec-ch-ua-platform'][0]
          : req.headers['sec-ch-ua-platform']),
    };

    const result = await this.googleOAuthService.handleCallback(
      body.code,
      body.state,
      meta,
    );

    return {
      success: true,
      message: result.isNewUser
        ? 'Account created successfully via Google'
        : 'Signed in successfully via Google',
      data: result,
    };
  }

  // ==========================================
  // Login/Logout Endpoints
  // ==========================================

  /**
   * Login with email and password
   */
  @ApiOperation({
    summary: 'Login with email and password',
    description:
      'Authenticates a verified local account and returns access and refresh tokens.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Login successful.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: {
          success: true,
          message: 'Login successful',
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh',
          user: {
            id: '65f1c2a6e5b9a2d8a4f2c111',
            email: 'jordan@example.com',
            fullName: 'Jordan Davis',
            role: 'customer',
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.' })
  @ApiForbiddenResponse({
    description: 'Email is unverified or account access is blocked.',
  })
  @Post('login')
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const { email, password } = loginDto;
    this.customLogger.log(
      `Login attempt for email: ${email}`,
      'AuthController',
    );

    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      device:
        (Array.isArray(req.headers['x-device'])
          ? req.headers['x-device'][0]
          : req.headers['x-device']) ||
        (Array.isArray(req.headers['x-device-id'])
          ? req.headers['x-device-id'][0]
          : req.headers['x-device-id']) ||
        (Array.isArray(req.headers['sec-ch-ua-platform'])
          ? req.headers['sec-ch-ua-platform'][0]
          : req.headers['sec-ch-ua-platform']),
    };

    const result = await this.authService.login({ email, password }, meta);

    return {
      success: true,
      message: 'Login successful',
      ...result,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Rotates a valid refresh token and returns a fresh access token/session payload.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({ description: 'Token refreshed successfully.' })
  @ApiUnauthorizedResponse({ description: 'Refresh token is invalid.' })
  @Post('refresh-token')
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() req: Request,
  ) {
    const { refreshToken } = refreshTokenDto;
    this.customLogger.log('Token refresh requested', 'AuthController');

    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      device:
        (Array.isArray(req.headers['x-device'])
          ? req.headers['x-device'][0]
          : req.headers['x-device']) ||
        (Array.isArray(req.headers['x-device-id'])
          ? req.headers['x-device-id'][0]
          : req.headers['x-device-id']) ||
        (Array.isArray(req.headers['sec-ch-ua-platform'])
          ? req.headers['sec-ch-ua-platform'][0]
          : req.headers['sec-ch-ua-platform']),
    };

    const result = await this.authService.refreshToken(refreshToken, meta);

    return {
      success: true,
      message: 'Token refreshed successfully',
      ...result,
    };
  }

  /**
   * Logout current session
   */
  @ApiOperation({
    summary: 'Logout current session',
    description: 'Revokes one refresh token for the supplied user ID.',
  })
  @ApiBody({ type: LogoutDto })
  @ApiOkResponse({ description: 'Current session logged out successfully.' })
  @Post('logout')
  async logout(
    @Body() logoutDto: LogoutDto,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Req() req: Request,
  ) {
    const { refreshToken, userId } = logoutDto;
    this.customLogger.log('Logout requested', 'AuthController');

    const result = await this.authService.logout(refreshToken, userId);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Logout from all devices
   */
  @ApiOperation({
    summary: 'Logout all sessions',
    description: 'Revokes all active refresh-token sessions for a user.',
  })
  @ApiBody({ type: LogoutAllDto })
  @ApiOkResponse({ description: 'All sessions logged out successfully.' })
  @Post('logout-all')
  async logoutAll(@Body() logoutAllDto: LogoutAllDto) {
    const { userId } = logoutAllDto;
    this.customLogger.log(
      `Logout all devices requested for user: ${userId}`,
      'AuthController',
    );

    const result = await this.authService.logoutAllDevices(userId);

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Change password for authenticated user
   * Requires current password and access token
   */
  @ApiOperation({
    summary: 'Change authenticated user password',
    description:
      'Changes the password for the JWT-authenticated user after validating the current password.',
  })
  @ApiBearerAuth('JWT-auth')
  @ApiOkResponse({ description: 'Password changed successfully.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  @ApiBadRequestResponse({
    description: 'Invalid old password or new password.',
  })
  @UseGuards(AuthGuard)
  @Post('change-password')
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    // User info is attached to request by AuthGuard
    const user = req['user'];
    const userId = user?.userId ?? user?.authId ?? user?.id;

    this.customLogger.log(
      `Password change request for user: ${userId}`,
      'AuthController',
    );

    const meta = {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    return this.authService.changePassword(
      userId,
      changePasswordDto.oldPassword,
      changePasswordDto.newPassword,
      meta,
    );
  }
}
