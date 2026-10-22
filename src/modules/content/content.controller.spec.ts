import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Request } from 'express';
import type { Logger } from 'winston';
import { StoriesController, ProjectsController } from './content.controller';
import { ContentService } from './content.service';
import { StoryAnalyticsService } from './story-analytics.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';

describe('content HTTP integration', () => {
  let app: INestApplication<Server>;
  const content = {
    listStories: jest
      .fn()
      .mockResolvedValue({ success: true, data: [], pagination: { total: 0 } }),
    saveStory: jest
      .fn()
      .mockResolvedValue({ success: true, data: { slug: 'new-story' } }),
    saveProject: jest
      .fn()
      .mockResolvedValue({ success: true, data: { name: 'Project' } }),
  };
  const analytics = {
    report: jest
      .fn()
      .mockResolvedValue({ success: true, data: { days: 30, stories: [] } }),
    record: jest
      .fn()
      .mockResolvedValue({ success: true, data: { accepted: true } }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoriesController, ProjectsController],
      providers: [
        { provide: ContentService, useValue: content },
        { provide: StoryAnalyticsService, useValue: analytics },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context
            .switchToHttp()
            .getRequest<Request & { user?: { role: string } }>();
          const role = req.headers['x-test-role'];
          if (!role) throw new UnauthorizedException();
          req.user = { role: String(role) };
          return true;
        },
      })
      .overrideGuard(OptionalAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context
            .switchToHttp()
            .getRequest<Request & { user?: { role: string } }>();
          const role = req.headers['x-test-role'];
          if (role) req.user = { role: String(role) };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new TransformInterceptor({ info: jest.fn() } as unknown as Logger),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('keeps public pagination at the top level through the global interceptor', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/real-shipment-stories')
      .expect(200);
    expect(result.body).toEqual({
      success: true,
      data: [],
      pagination: { total: 0 },
    });
    expect(result.headers['cache-control']).toBe(
      'public, max-age=0, s-maxage=30',
    );
    expect(result.headers.vary).toContain('Authorization');
  });
  it('restricts readership reporting to admins and story managers without public caching', async () => {
    const url =
      '/api/v1/real-shipment-stories/analytics?storyIds=507f1f77bcf86cd799439011';
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer())
      .get(url)
      .set('x-test-role', 'customer')
      .expect(403);
    await request(app.getHttpServer())
      .get(url)
      .set('x-test-role', 'operations_manager')
      .expect(403);
    const result = await request(app.getHttpServer())
      .get(url)
      .set('x-test-role', 'story_manager')
      .expect(200);
    expect(result.body).toEqual({
      success: true,
      data: { days: 30, stories: [] },
    });
    expect(result.headers['cache-control']).toBe('private, no-store');
    const detail = await request(app.getHttpServer())
      .get(
        '/api/v1/real-shipment-stories/507f1f77bcf86cd799439011/analytics?days=7',
      )
      .set('x-test-role', 'admin')
      .expect(200);
    expect(detail.headers['cache-control']).toBe('private, no-store');
    expect(analytics.report).toHaveBeenLastCalledWith(
      { days: '7' },
      '507f1f77bcf86cd799439011',
    );
  });
  it('accepts public telemetry using the content envelope and disables caching', async () => {
    const body = {
      viewId: '2fb2fcb4-4801-49ad-820d-6d3a94df8d76',
      event: 'open',
      activeSeconds: 0,
      progress: 0,
    };
    const result = await request(app.getHttpServer())
      .post('/api/v1/real-shipment-stories/507f1f77bcf86cd799439011/events')
      .send(body)
      .expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual({ success: true, data: { accepted: true } });
    expect(analytics.record).toHaveBeenLastCalledWith(
      '507f1f77bcf86cd799439011',
      body,
    );
  });
  it('requires authentication and admin role for writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .send({ name: 'Project', type: 'web' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('x-test-role', 'customer')
      .send({ name: 'Project', type: 'web' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('x-test-role', 'admin')
      .send({ name: 'Project', type: 'web' })
      .expect(201);
  });
  it('accepts multipart story fields through the existing global validation pipe', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/real-shipment-stories')
      .set('x-test-role', 'admin')
      .field('title', 'New story')
      .field('faqs', '[]')
      .expect(201);
    expect(content.saveStory).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New story', faqs: '[]' }),
      undefined,
    );
  });
  it('allows story managers to view drafts and write stories, but denies operations managers', async () => {
    const managerList = await request(app.getHttpServer())
      .get('/api/v1/real-shipment-stories')
      .set('x-test-role', 'story_manager')
      .expect(200);
    expect(managerList.headers['cache-control']).toBe('private, no-store');
    expect(content.listStories).toHaveBeenLastCalledWith({}, true);

    await request(app.getHttpServer())
      .post('/api/v1/real-shipment-stories')
      .set('x-test-role', 'story_manager')
      .field('title', 'Managed story')
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/real-shipment-stories')
      .set('x-test-role', 'operations_manager')
      .field('title', 'Denied story')
      .expect(403);
  });
});
