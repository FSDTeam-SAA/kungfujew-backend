import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../../common/common.module';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { ProjectsController, StoriesController } from './content.controller';
import { ContentService } from './content.service';
import { ProjectSchema, StorySchema } from './content.schemas';

@Module({
  imports: [
    CommonModule,
    MongooseModule.forFeature([
      { name: 'RealShipmentStory', schema: StorySchema },
      { name: 'Project', schema: ProjectSchema },
    ]),
  ],
  controllers: [StoriesController, ProjectsController],
  providers: [ContentService, OptionalAuthGuard],
})
export class ContentModule {}
