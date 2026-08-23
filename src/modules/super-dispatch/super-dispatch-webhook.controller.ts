import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { SuperDispatchWebhookService } from './super-dispatch-webhook.service';
import { SuperDispatchWebhookPayload } from './dto/webhook-payload.dto';
import {
  WebhookProvider,
  WebhookSecurityService,
} from '../../common/services/webhook-security.service';

@ApiTags('super-dispatch')
@Controller('webhooks/super-dispatch')
export class SuperDispatchWebhookController {
  constructor(
    private readonly webhookService: SuperDispatchWebhookService,
    private readonly webhookSecurityService: WebhookSecurityService,
  ) {}

  @ApiOperation({
    summary: 'Receive Super Dispatch webhook events',
    description:
      'Accepts BOL completed, delivery notification, and order status change webhooks from Super Dispatch.',
  })
  @ApiBody({ type: SuperDispatchWebhookPayload })
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: SuperDispatchWebhookPayload) {
    this.webhookSecurityService.assertLegacyEndpointEnabled(
      WebhookProvider.SUPER_DISPATCH,
    );
    await this.processWebhook(payload);
    return { received: true };
  }

  @ApiOperation({
    summary: 'Receive an authenticated Super Dispatch webhook event',
  })
  @Post('secure/:token')
  @HttpCode(HttpStatus.OK)
  async handleSecureWebhook(
    @Param('token') token: string,
    @Body() payload: SuperDispatchWebhookPayload,
  ) {
    this.webhookSecurityService.assertSecureToken(
      WebhookProvider.SUPER_DISPATCH,
      token,
    );
    await this.processWebhook(payload);
    return { received: true };
  }

  private async processWebhook(
    payload: SuperDispatchWebhookPayload,
  ): Promise<void> {
    await this.webhookSecurityService.processOnce(
      WebhookProvider.SUPER_DISPATCH,
      [
        payload.event,
        payload.orderId,
        payload.externalOrderId ?? '',
        payload.timestamp,
      ].join(':'),
      async () => {
        await this.webhookService.processWebhook(payload);
      },
    );
  }
}
