import { Model } from 'mongoose';
import { ContentService } from './content.service';
import { Project, Story } from './content.schemas';
import { CloudinaryService } from '../../common/services/cloudinary.service';

describe('content visibility and publishing', () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    maxTimeMS: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  const stories = {
    find: jest.fn(() => chain),
    countDocuments: jest.fn(() => ({
      maxTimeMS: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(0),
    })),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const service = new ContentService(
    stories as unknown as Model<Story>,
    {} as Model<Project>,
    {} as CloudinaryService,
  );
  beforeEach(() => jest.clearAllMocks());
  it('does not let public clients request drafts', async () => {
    await service.listStories(
      { isPublished: 'false', serviceLine: 'All' },
      false,
    );
    expect(stories.find).toHaveBeenCalledWith({
      isPublished: true,
      serviceLine: { $in: ['vehicle', 'freight', 'heavy-equipment'] },
    });
  });
  it('allows admins to filter drafts', async () => {
    await service.listStories({ isPublished: 'false' }, true);
    expect(stories.find).toHaveBeenCalledWith({ isPublished: false });
  });

  it('omits article bodies only when a client requests summaries', async () => {
    await service.listStories({ summary: 'true' }, false);
    expect(chain.select).toHaveBeenLastCalledWith('-content -faqs');
    await service.listStories({}, false);
    expect(chain.select).toHaveBeenLastCalledWith('');
  });
  it('hides unpublished detail pages from public users', async () => {
    stories.findOne.mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue({ isPublished: false, serviceLine: 'vehicle' }),
    });
    await expect(service.getStory('draft', false)).rejects.toThrow(
      'Shipment story not found',
    );
    await expect(service.getStory('draft', true)).resolves.toMatchObject({
      success: true,
    });
  });
  it('does not publish legacy stories without a service line', async () => {
    stories.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ isPublished: false }),
    });
    await expect(
      service.publish('507f1f77bcf86cd799439011', true),
    ).rejects.toThrow('Assign a serviceLine');
    expect(stories.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a stale editor without uploading or updating', async () => {
    stories.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        isPublished: false,
        updatedAt: new Date('2026-10-12T00:00:00.000Z'),
      }),
    });
    await expect(
      service.saveStory(
        { title: 'Old edit', baseUpdatedAt: '2026-10-11T00:00:00.000Z' },
        undefined,
        '507f1f77bcf86cd799439011',
      ),
    ).rejects.toThrow('This story changed');
    expect(stories.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('checks the story version atomically to prevent racing overwrites', async () => {
    const updatedAt = new Date('2026-10-12T00:00:00.000Z');
    stories.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ isPublished: false, updatedAt }),
    });
    stories.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.saveStory(
        { title: 'Racing edit', baseUpdatedAt: updatedAt.toISOString() },
        undefined,
        '507f1f77bcf86cd799439011',
      ),
    ).rejects.toThrow('This story changed');
    expect(stories.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011', updatedAt },
      { title: 'Racing edit' },
      { new: true, runValidators: true },
    );
  });

  it('rejects publishing an incomplete legacy story even with a service line', async () => {
    const legacy = {
      isPublished: false,
      serviceLine: 'vehicle',
      title: 'Legacy',
      slug: 'legacy',
      metaDescription: 'A move',
      content: '<p><br></p>',
      pickupLocation: 'Austin',
      destination: 'Boston',
      shipmentType: 'Car',
    };
    stories.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...legacy, toObject: () => legacy }),
    });
    await expect(
      service.publish('507f1f77bcf86cd799439011', true),
    ).rejects.toThrow('Story content must include text');
    expect(stories.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
