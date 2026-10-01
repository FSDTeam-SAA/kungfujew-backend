import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { Project, SERVICE_LINES, Story } from './content.schemas';
import {
  booleanValue,
  contentInput,
  escapeRegex,
  pagination,
  queryText,
} from './content.validation';

@Injectable()
export class ContentService {
  constructor(
    @InjectModel('RealShipmentStory') private readonly stories: Model<Story>,
    @InjectModel('Project') private readonly projects: Model<Project>,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async listStories(query: Record<string, unknown>, admin: boolean) {
    const filter: FilterQuery<Story> = admin
      ? {}
      : { isPublished: true, serviceLine: { $in: SERVICE_LINES } };
    const published = queryText(query.isPublished);
    if (admin && published && published.toLowerCase() !== 'all')
      filter.isPublished = booleanValue(published);
    const line = queryText(query.serviceLine).toLowerCase();
    if (line && line !== 'all') {
      if (!SERVICE_LINES.includes(line))
        throw new BadRequestException('Invalid serviceLine');
      filter.serviceLine = line;
    }
    const status = queryText(query.shipmentStatus);
    if (status && status.toLowerCase() !== 'all')
      filter.shipmentStatus = status;
    const type = queryText(query.shipmentType);
    if (type && type.toLowerCase() !== 'all')
      filter.shipmentType = { $regex: escapeRegex(type), $options: 'i' };
    const search = queryText(query.search);
    if (search)
      filter.$or = [
        'title',
        'pickupLocation',
        'destination',
        'shipmentType',
        'slug',
      ].map((field) => ({
        [field]: { $regex: escapeRegex(search), $options: 'i' },
      }));
    return this.list(this.stories, filter, query);
  }

  async listProjects(query: Record<string, unknown>) {
    const filter: FilterQuery<Project> = {};
    for (const field of ['category', 'type']) {
      const value = queryText(query[field]);
      if (value && value.toLowerCase() !== 'all') filter[field] = value;
    }
    const words = queryText(query.search).split(/\s+/).filter(Boolean);
    if (words.length)
      filter.$and = words.map((word) => ({
        $or: ['name', 'category'].map((field) => ({
          [field]: { $regex: escapeRegex(word), $options: 'i' },
        })),
      }));
    return this.list(this.projects, filter, query);
  }

  private async list<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    query: Record<string, unknown>,
  ) {
    const { page, limit } = pagination(query);
    const [data, total] = await Promise.all([
      model
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      model.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getStory(identifier: string, admin: boolean, slugOnly = false) {
    let story =
      !slugOnly && Types.ObjectId.isValid(identifier)
        ? await this.stories.findById(identifier).exec()
        : null;
    story ??= await this.stories
      .findOne({ slug: identifier.trim().toLowerCase() })
      .exec();
    if (
      !story ||
      (!admin &&
        (!story.isPublished || !SERVICE_LINES.includes(story.serviceLine)))
    )
      throw new NotFoundException('Shipment story not found');
    return { success: true, data: story };
  }

  async getProject(id: string) {
    this.checkId(id);
    const project = await this.projects.findById(id).exec();
    if (!project) throw new NotFoundException('Project not found');
    return { success: true, data: project };
  }

  async saveStory(
    body: Record<string, unknown>,
    file?: Express.Multer.File,
    id?: string,
  ) {
    const input = contentInput(body, 'story', !id);
    if (id) {
      this.checkId(id);
      const existing = await this.getStory(id, true);
      if (
        input.isPublished &&
        !SERVICE_LINES.includes(
          queryText(input.serviceLine ?? existing.data.serviceLine),
        )
      )
        throw new BadRequestException('Assign a serviceLine before publishing');
    }
    if (file) input.image = (await this.upload(file)).url;
    return this.write(async () => {
      const data = id
        ? await this.stories
            .findByIdAndUpdate(id, input, { new: true, runValidators: true })
            .exec()
        : await this.stories.create(input);
      if (!data) throw new NotFoundException('Shipment story not found');
      return { success: true, data };
    });
  }

  async saveProject(body: Record<string, unknown>, id?: string) {
    const input = contentInput(body, 'project', !id);
    if (id) this.checkId(id);
    return this.write(async () => {
      const data = id
        ? await this.projects
            .findByIdAndUpdate(id, input, { new: true, runValidators: true })
            .exec()
        : await this.projects.create(input);
      if (!data) throw new NotFoundException('Project not found');
      return { success: true, data };
    });
  }

  async publish(id: string, value: unknown) {
    this.checkId(id);
    const { data: story } = await this.getStory(id, true);
    const isPublished =
      value === undefined ? !story.isPublished : booleanValue(value);
    if (isPublished && !SERVICE_LINES.includes(story.serviceLine))
      throw new BadRequestException('Assign a serviceLine before publishing');
    return this.saveStory({ isPublished }, undefined, id);
  }

  async remove(kind: 'story' | 'project', id: string) {
    this.checkId(id);
    const data =
      kind === 'story'
        ? await this.stories.findByIdAndDelete(id).exec()
        : await this.projects.findByIdAndDelete(id).exec();
    if (!data) throw new NotFoundException('Content not found');
    return { success: true, message: 'Deleted successfully' };
  }

  async upload(file?: Express.Multer.File) {
    if (!file || !/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype))
      throw new BadRequestException(
        'Provide a JPEG, PNG, WebP, GIF or AVIF image',
      );
    const { url } = await this.cloudinary.uploadImage(
      file.buffer,
      'real-shipment-stories',
    );
    return { success: true, url };
  }

  private checkId(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid content ID');
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error && typeof error === 'object') {
        if ('code' in error && error.code === 11000)
          throw new BadRequestException('Slug already exists');
        if ('name' in error && error.name === 'ValidationError')
          throw new BadRequestException('Invalid content fields');
      }
      throw error;
    }
  }
}
