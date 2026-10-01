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
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoriesController, ProjectsController],
      providers: [{ provide: ContentService, useValue: content }],
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
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
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
});
