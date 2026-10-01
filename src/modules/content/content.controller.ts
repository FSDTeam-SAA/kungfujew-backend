import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  SetMetadata,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../auth/interfaces/auth.interface';
import { ContentService } from './content.service';

type ContentRequest = Request & { user?: { role: UserRole } };
const imageUpload = FileInterceptor('image', {
  limits: { fileSize: 10 * 1024 * 1024 },
});

@SetMetadata('contentResponse', true)
@Controller('api/v1/real-shipment-stories')
export class StoriesController {
  constructor(private readonly content: ContentService) {}
  @Get()
  @UseGuards(OptionalAuthGuard)
  list(@Query() query: Record<string, unknown>, @Req() req: ContentRequest) {
    return this.content.listStories(query, req.user?.role === UserRole.ADMIN);
  }
  @Get('slug/:slug')
  @UseGuards(OptionalAuthGuard)
  slug(@Param('slug') slug: string, @Req() req: ContentRequest) {
    return this.content.getStory(slug, req.user?.role === UserRole.ADMIN, true);
  }
  @Get(':idOrSlug')
  @UseGuards(OptionalAuthGuard)
  detail(@Param('idOrSlug') id: string, @Req() req: ContentRequest) {
    return this.content.getStory(id, req.user?.role === UserRole.ADMIN);
  }
  @Post('upload-image')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(imageUpload)
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.content.upload(file);
  }
  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(imageUpload)
  create(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.content.saveStory(body, file);
  }
  @Put(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  publish(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.content.publish(id, body.isPublished);
  }
  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.content.remove('story', id);
  }
}

@SetMetadata('contentResponse', true)
@Controller('api/v1/projects')
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
