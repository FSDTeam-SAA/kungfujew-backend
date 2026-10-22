import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  SetMetadata,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../auth/interfaces/auth.interface';
import { ContentService } from './content.service';
import { StoryAnalyticsService } from './story-analytics.service';

type ContentRequest = Request & { user?: { role: UserRole } };
const imageUpload = FileInterceptor('image', {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 20,
    parts: 21,
    fieldSize: 2 * 1024 * 1024,
  },
});

@SetMetadata('contentResponse', true)
@Controller('real-shipment-stories')
export class StoriesController {
  constructor(
    private readonly content: ContentService,
    private readonly analytics: StoryAnalyticsService,
  ) {}
  @Get()
  @UseGuards(OptionalAuthGuard)
  async list(
    @Query() query: Record<string, unknown>,
    @Req() req: ContentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isManager =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.STORY_MANAGER;
    const result = await this.content.listStories(query, isManager);
    this.cacheHeaders(req, res);
    return result;
  }
  @Get('analytics')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  readership(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    return this.analytics.report(query);
  }

  @Get(':id/analytics')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  storyReadership(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    return this.analytics.report(query, id);
  }

  @Post(':id/events')
  @HttpCode(200)
  recordEvent(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.analytics.record(id, body);
  }

  @Get('slug/:slug')
  @UseGuards(OptionalAuthGuard)
  async slug(
    @Param('slug') slug: string,
    @Req() req: ContentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isManager =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.STORY_MANAGER;
    const result = await this.content.getStory(slug, isManager, true);
    this.cacheHeaders(req, res);
    return result;
  }
  @Get(':idOrSlug')
  @UseGuards(OptionalAuthGuard)
  async detail(
    @Param('idOrSlug') id: string,
    @Req() req: ContentRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isManager =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.STORY_MANAGER;
    const result = await this.content.getStory(id, isManager);
    this.cacheHeaders(req, res);
    return result;
  }

  private cacheHeaders(req: ContentRequest, res: Response) {
    res.vary('Authorization');
    res.setHeader(
      'Cache-Control',
      req.user || req.headers.authorization
        ? 'private, no-store'
        : 'public, max-age=0, s-maxage=30',
    );
  }
  @Post('upload-image')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  @UseInterceptors(imageUpload)
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.content.upload(file);
  }
  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  @UseInterceptors(imageUpload)
  create(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.content.saveStory(body, file);
  }
  @Put(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  @UseInterceptors(imageUpload)
  update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.content.saveStory(body, file, id);
  }
  @Patch(':id/publish')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  publish(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.content.publish(id, body.isPublished);
  }
  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STORY_MANAGER)
  remove(@Param('id') id: string) {
    return this.content.remove('story', id);
  }
}

@SetMetadata('contentResponse', true)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly content: ContentService) {}
  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.content.listProjects(query);
  }
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.content.getProject(id);
  }
  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() body: Record<string, unknown>) {
    return this.content.saveProject(body);
  }
  @Put(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.content.saveProject(body, id);
  }
  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.content.remove('project', id);
  }
}
