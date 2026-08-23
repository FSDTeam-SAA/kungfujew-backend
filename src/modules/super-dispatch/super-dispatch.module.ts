import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SuperDispatchAuthService } from './super-dispatch-auth.service';
import { SuperDispatchOrderService } from './super-dispatch-order.service';
import { SuperDispatchWebhookController } from './super-dispatch-webhook.controller';
import { SuperDispatchWebhookService } from './super-dispatch-webhook.service';
import { OrderSchema } from '../customer/schemas/order.schema';
import { DeliveryModule } from '../delivery/delivery.module';
import { WebhookSecurityService } from '../../common/services/webhook-security.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    ConfigModule,
    MongooseModule.forFeature([{ name: 'Order', schema: OrderSchema }]),
    DeliveryModule,
  ],
  controllers: [SuperDispatchWebhookController],
  providers: [
    SuperDispatchAuthService,
    SuperDispatchOrderService,
    SuperDispatchWebhookService,
    WebhookSecurityService,
  ],
  exports: [SuperDispatchAuthService, SuperDispatchOrderService],
})
export class SuperDispatchModule {}
