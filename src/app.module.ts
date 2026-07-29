import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ContactModule } from './modules/contact/contact.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './common/modules/redis.module';
import { MetricsModule } from './metrics/metrics.module';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './common/config/winston.config';
import { LoggerModule } from './common/modules/logger.module';
import { CustomerModule } from './modules/customer/customer.module';
import { QueueModule } from './common/modules/queue.module';
import { AdminModule } from './modules/admin/admin.module';
import { SuperDispatchModule } from './modules/super-dispatch/super-dispatch.module';
import { TailwindTmsModule } from './modules/tailwind-tms/tailwind-tms.module';
import { QuickBooksModule } from './modules/quickbooks/quickbooks.module';
import { CarrierModule } from './modules/carrier/carrier.module';
import { ScheduledTasksModule } from './modules/scheduled-tasks/scheduled-tasks.module';
import { DeliveryModule } from './modules/delivery/delivery.module';

@Module({
  imports: [
    // Load environment variables globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // Winston logger module (global - can be injected anywhere)
    WinstonModule.forRoot(winstonConfig),
    // Custom logger module (global - can be injected anywhere)
    LoggerModule,
    // Database module (MongoDB with Mongoose)
    DatabaseModule,
    // Redis module (global - can be injected anywhere)
    RedisModule,
    // BullMQ queues backed by Redis
    QueueModule,
    // Metrics module (global - Prometheus metrics)
    MetricsModule,
    // BlogModule,
    AuthModule,
    UserModule,
    ContactModule,
    CustomerModule,
    AdminModule,
    SuperDispatchModule,
    TailwindTmsModule,
    QuickBooksModule,
    CarrierModule,
    ScheduledTasksModule,
    DeliveryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
