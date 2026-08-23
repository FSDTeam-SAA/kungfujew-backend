import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IOrder } from '../customer/schemas/order.schema';
import { DeliveryHandlerService } from '../delivery/delivery-handler.service';
import { TailwindTmsWebhookPayload } from './dto/webhook-payload.dto';
import {
  WebhookProvider,
  WebhookSecurityService,
} from '../../common/services/webhook-security.service';

@ApiTags('tailwind-tms')
@Controller('webhooks/tailwind-tms')
export class TailwindTmsWebhookController {
  private readonly logger = new Logger(TailwindTmsWebhookController.name);

  constructor(
    @InjectModel('Order') private readonly orderModel: Model<IOrder>,
    private readonly deliveryHandler: DeliveryHandlerService,
    private readonly webhookSecurityService: WebhookSecurityService,
  ) {}

  @ApiOperation({
    summary: 'Receive Tailwind TMS delivery confirmation webhook',
  })
  @ApiBody({ type: TailwindTmsWebhookPayload })
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: TailwindTmsWebhookPayload) {
    this.webhookSecurityService.assertLegacyEndpointEnabled(
      WebhookProvider.TAILWIND_TMS,
    );
    await this.processWebhook(payload);
    return { received: true };
  }

  @ApiOperation({
    summary: 'Receive an authenticated Tailwind TMS webhook event',
  })
  @Post('secure/:token')
  @HttpCode(HttpStatus.OK)
  async handleSecureWebhook(
    @Param('token') token: string,
    @Body() payload: TailwindTmsWebhookPayload,
  ) {
    this.webhookSecurityService.assertSecureToken(
      WebhookProvider.TAILWIND_TMS,
      token,
    );
    await this.processWebhook(payload);
    return { received: true };
  }

  private async processWebhook(
    payload: TailwindTmsWebhookPayload,
  ): Promise<void> {
    const shipmentId = payload.shipmentId || payload.id;
    const event = payload.event;
    const status = payload.status;
    this.logger.log(
      `Tailwind TMS webhook received: event=${event}, shipmentId=${shipmentId}`,
    );

    await this.webhookSecurityService.processOnce(
      WebhookProvider.TAILWIND_TMS,
      [event ?? '', status ?? '', shipmentId ?? ''].join(':'),
      async () => {
        if (event === 'delivery_confirmed' || status === 'Delivered') {
          const order = await this.orderModel
            .findOne({ 'integrationStatus.tailwindTms.shipmentId': shipmentId })
            .exec();

          if (order) {
            await this.orderModel.updateOne(
              { orderId: order.orderId },
              {
                $set: {
                  isBalanceAlertActive: false,
                  'integrationStatus.tailwindTms.deliveredAt': new Date(),
                  'integrationStatus.tailwindTms.deliveryData': payload,
                },
              },
            );
            await this.deliveryHandler.handleDelivery(
              order.orderId,
              'tailwind_tms',
            );
            this.logger.log(
              `Delivery confirmed for order ${order.orderId} via Tailwind TMS webhook`,
            );
          }
        }
      },
    );
  }
}
