import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { QuickBooksAuthService } from './quickbooks-auth.service';
import { QuickBooksPaymentService } from './quickbooks-payment.service';
import { QuickBooksInvoiceService } from './quickbooks-invoice.service';
import { QuickBooksController } from './quickbooks.controller';
import { QuickBooksWebhookController } from './quickbooks-webhook.controller';
import { QuickBooksConnectionModel } from './schemas/quickbooks-connection.schema';
import { CommonModule } from '../../common/common.module';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    ConfigModule,
    CommonModule,
    MongooseModule.forFeature([QuickBooksConnectionModel]),
  ],
  controllers: [QuickBooksController, QuickBooksWebhookController],
  providers: [
    QuickBooksAuthService,
    QuickBooksPaymentService,
    QuickBooksInvoiceService,
    RolesGuard,
  ],
  exports: [
    QuickBooksAuthService,
    QuickBooksPaymentService,
    QuickBooksInvoiceService,
  ],
})
export class QuickBooksModule {}
