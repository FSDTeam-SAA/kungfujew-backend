import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @ApiOperation({
    summary: 'Get Prometheus metrics',
    description: 'Returns raw Prometheus exposition-format metrics.',
  })
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'Prometheus metrics in text exposition format.',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
          example:
            '# HELP http_requests_total Total number of HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method="GET",route="/",status_code="200"} 1',
        },
      },
    },
  })
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }

  @ApiOperation({
    summary: 'Get metrics in JSON format',
    description:
      'Returns application metrics as JSON for dashboards and API consumers that do not parse Prometheus text.',
  })
  @ApiOkResponse({
    description: 'Metrics returned as JSON.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: {
          uptime: 3600,
          memory: { rss: 104857600, heapUsed: 52428800 },
          httpRequests: [],
        },
      },
    },
  })
  @Get('metrics/json')
  async getMetricsJSON(): Promise<any> {
    return this.metricsService.getMetricsJSON();
  }
}
