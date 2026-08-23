import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Logger,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { QuickBooksAuthService } from './quickbooks-auth.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../auth/interfaces/auth.interface';

type AuthenticatedRequest = {
  user?: {
    userId?: string;
  };
};

@ApiTags('quickbooks')
@Controller('quickbooks')
export class QuickBooksController {
  private readonly logger = new Logger(QuickBooksController.name);

  constructor(
    private readonly authService: QuickBooksAuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({
    summary: 'Start QuickBooks OAuth2 connection flow',
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Get('connect')
  async connect(@Req() request: AuthenticatedRequest, @Res() res: Response) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('No authenticated user found');
    }

    const url = await this.authService.getAuthorizationUrl(userId);
    return res.redirect(url);
  }

  @ApiOperation({
    summary: 'QuickBooks OAuth2 callback handler',
  })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'realmId', required: true })
  @ApiQuery({ name: 'state', required: true })
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.authService.handleOAuthCallback(
      code,
      realmId,
      state,
    );
    if (result.success) {
      return res.redirect(this.getDashboardRedirect('connected'));
    }
    return res.redirect(this.getDashboardRedirect('error'));
  }

  @ApiOperation({
    summary: 'Check QuickBooks connection status',
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Get('status')
  async status() {
    return this.authService.getConnectionStatus();
  }

  @ApiOperation({
    summary: 'Disconnect QuickBooks',
  })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Post('disconnect')
  async disconnect() {
    await this.authService.disconnect();
    return { success: true, message: 'QuickBooks disconnected' };
  }

  private getDashboardRedirect(status: 'connected' | 'error'): string {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const redirectUrl = new URL('/dashboard', frontendUrl);
    redirectUrl.searchParams.set('quickbooks', status);
    return redirectUrl.toString();
  }
}
