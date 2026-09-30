import { Model } from 'mongoose';
import { ContentService } from './content.service';
import { Project, Story } from './content.schemas';
import { CloudinaryService } from '../../common/services/cloudinary.service';

describe('content visibility and publishing', () => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  const stories = {
    find: jest.fn(() => chain),
    countDocuments: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(0) })),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
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
});
