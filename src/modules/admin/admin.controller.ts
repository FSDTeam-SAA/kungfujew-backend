import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminService } from './admin.service';
import {
  AdminOrderQueryDto,
  ConfirmManualPaymentDto,
  ReviewOrderDto,
  UpdateOrderPriceDto,
} from './dto/update-order-price.dto';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
    role?: string;
  };
};

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
@ApiForbiddenResponse({ description: 'Authenticated user is not an admin.' })
@Controller('admin')
@UseGuards(AuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({
    summary: 'Get dashboard summary',
    description:
      'Returns aggregate order metrics and recent orders for the admin dashboard overview.',
  })
  @ApiOkResponse({ description: 'Dashboard summary returned successfully.' })
  @Get('dashboard/summary')
  async getDashboardSummary(@Req() req: AuthenticatedRequest) {
    this.assertAdmin(req);
    return this.adminService.getDashboardSummary();
  }

  @ApiOperation({
    summary: 'List orders',
    description:
      'Returns paginated order records for admin operations, with optional status and text search filters.',
  })
  @ApiOkResponse({
    description: 'Paginated order list returned successfully.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: {
          items: [
            {
              orderId: 'CCG-7788JD',
              customerName: 'Jordan Davis',
              status: 'Booked',
              subTotal: 1250,
              balanceAmountRemaining: 875,
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    },
  })
  @Get('orders')
  async listOrders(
    @Query() queryDto: AdminOrderQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.listOrders(queryDto);
  }

  @ApiOperation({
    summary: 'List orders with outstanding balances',
    description:
      'Returns orders where a remaining customer balance is still due.',
  })
  @ApiOkResponse({
    description: 'Paginated balance-due order list returned successfully.',
  })
  @Get('orders/balance-due')
  async listBalanceDue(
    @Query() queryDto: AdminOrderQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.listBalanceDue(queryDto);
  }

  @ApiOperation({
    summary: 'List customer summaries',
    description:
      'Returns paginated customer aggregates based on order history.',
  })
  @ApiOkResponse({ description: 'Paginated customer list returned successfully.' })
  @Get('customers')
  async listCustomers(
    @Query() queryDto: AdminOrderQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.listCustomers(queryDto);
  }

  @ApiOperation({
    summary: 'Get customer details',
    description: 'Returns customer profile details and all orders for an email.',
  })
  @ApiOkResponse({ description: 'Customer details returned successfully.' })
  @ApiNotFoundResponse({ description: 'Customer was not found.' })
  @Get('customers/:email')
  async getCustomer(
    @Param('email') email: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.getCustomer(email);
  }

  @ApiOperation({
    summary: 'List payment records',
    description:
      'Returns paginated orders with payment activity for the payments dashboard.',
  })
  @ApiOkResponse({ description: 'Paginated payment list returned successfully.' })
  @Get('payments')
  async listPayments(
    @Query() queryDto: AdminOrderQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.listPayments(queryDto);
  }

  @ApiOperation({
    summary: 'Get order details',
    description: 'Returns a single order by its customer-facing order ID.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({ description: 'Order details returned successfully.' })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Get('orders/:orderId')
  async getOrder(
    @Param('orderId') orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.getOrder(orderId);
  }

  @ApiOperation({
    summary: 'Update order pricing',
    description:
      'Adjusts one or more price components, recalculates totals, and records the admin reason.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({ description: 'Order price updated successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid price update payload.' })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Patch('orders/:orderId/price')
  async updateOrderPrice(
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderPriceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.updateOrderPrice(orderId, dto, req.user?.userId);
  }

  @ApiOperation({
    summary: 'Mark order as reviewed',
    description:
      'Marks an order as reviewed by staff and queues follow-up order-review automation.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({ description: 'Order marked as reviewed.' })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Patch('orders/:orderId/review')
  async reviewOrder(
    @Param('orderId') orderId: string,
    @Body() dto: ReviewOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.reviewOrder(orderId, dto, req.user?.userId);
  }

  @ApiOperation({
    summary: 'Confirm manual payment',
    description:
      'Confirms Zelle, Venmo, Cash App, or other manual-payment receipt and moves the order into the booked review flow.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({
    description: 'Manual payment confirmed and order moved to review queue.',
  })
  @ApiBadRequestResponse({
    description: 'Order is not pending payment or payload is invalid.',
  })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Patch('orders/:orderId/manual-payment')
  async confirmManualPayment(
    @Param('orderId') orderId: string,
    @Body() dto: ConfirmManualPaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.confirmManualPayment(
      orderId,
      dto,
      req.user?.userId,
    );
  }

  @ApiOperation({
    summary: 'Approve booked order',
    description:
      'Approves a booked order for dispatch automation and queues downstream load-board work.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({
    description: 'Order approved and dispatch automation queued.',
  })
  @ApiBadRequestResponse({ description: 'Only booked orders can be approved.' })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Post('orders/:orderId/approve')
  async approveOrder(
    @Param('orderId') orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.approveOrder(orderId, req.user?.userId);
  }

  @ApiOperation({
    summary: 'Reject order',
    description: 'Cancels an order and records the rejection reason.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({ description: 'Order rejected successfully.' })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Post('orders/:orderId/reject')
  async rejectOrder(
    @Param('orderId') orderId: string,
    @Body('reason') reason: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.rejectOrder(orderId, reason, req.user?.userId);
  }

  @ApiOperation({
    summary: 'Queue balance reminder',
    description:
      'Queues a payment reminder for an order with an outstanding balance.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Customer-facing order reference.',
    example: 'CCG-7788JD',
  })
  @ApiOkResponse({ description: 'Balance reminder queued.' })
  @ApiBadRequestResponse({ description: 'Order has no outstanding balance.' })
  @ApiNotFoundResponse({ description: 'Order was not found.' })
  @Post('orders/:orderId/balance-reminder')
  async sendBalanceReminder(
    @Param('orderId') orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.assertAdmin(req);
    return this.adminService.sendBalanceReminder(orderId, req.user?.userId);
  }

  private assertAdmin(req: AuthenticatedRequest): void {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('Only admin users can access order ops.');
    }
  }
}
