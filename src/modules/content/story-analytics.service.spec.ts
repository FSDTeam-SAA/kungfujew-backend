import { Model } from 'mongoose';
import type { Redis } from 'ioredis';
import { Story } from './content.schemas';
import {
  StoryTracking,
  StoryVisit,
  StoryVisitSchema,
} from './story-analytics.schemas';
import { StoryAnalyticsService } from './story-analytics.service';

const id = '507f1f77bcf86cd799439011';
const event = {
  viewId: '2fb2fcb4-4801-49ad-820d-6d3a94df8d76',
  event: 'complete',
  activeSeconds: 30,
  progress: 90,
};

describe('story readership persistence and reporting', () => {
  const visits = {
    updateOne: jest.fn<unknown, [unknown, unknown, { upsert: boolean }]>(),
    aggregate: jest.fn(),
  };
  const tracking = { updateOne: jest.fn(), findById: jest.fn() };
  const stories = { exists: jest.fn() };
  const redis = { status: 'ready', eval: jest.fn() };
  const service = new StoryAnalyticsService(
    visits as unknown as Model<StoryVisit>,
    tracking as unknown as Model<StoryTracking>,
    stories as unknown as Model<Story>,
    redis as unknown as Redis,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-22T15:00:00Z'));
    redis.status = 'ready';
    redis.eval.mockResolvedValue(1);
    visits.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    visits.aggregate.mockReturnValue({
      option: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });
    tracking.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });
    tracking.findById.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue({ startedAt: new Date('2026-10-01T00:00:00Z') }),
    });
    stories.exists.mockReturnValue({
      maxTimeMS: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ _id: id }),
    });
  });
  afterEach(() => jest.useRealTimers());
  it('records out-of-order completions once without allowing later events to lower their stage', async () => {
    await expect(service.record(id, event)).resolves.toEqual({
      success: true,
      data: { accepted: true },
    });
    await service.record(id, {
      ...event,
      event: 'open',
      activeSeconds: 0,
      progress: 0,
    });
    const completeWrite = visits.updateOne.mock.calls[0][1] as {
      $max: { stage: number };
      $setOnInsert: { openedAt: Date; expiresAt: Date };
    };
    expect(completeWrite.$max.stage).toBe(2);
    expect(
      completeWrite.$setOnInsert.expiresAt.getTime() -
        completeWrite.$setOnInsert.openedAt.getTime(),
    ).toBe(90 * 86400000);
    expect(visits.updateOne.mock.calls[1][1]).toMatchObject({
      $max: { stage: 0 },
    });
    expect(StoryVisitSchema.indexes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          { storyId: 1, viewId: 1 },
          expect.objectContaining({ unique: true }),
        ]),
        expect.arrayContaining([
          { expiresAt: 1 },
          expect.objectContaining({ expireAfterSeconds: 0 }),
        ]),
      ]),
    );
  });
  it('retries a racing upsert against the unique visit without creating a second open', async () => {
    visits.updateOne.mockReturnValueOnce({
      exec: jest.fn().mockRejectedValue({ code: 11000 }),
    });
    await service.record(id, event);
    expect(visits.updateOne).toHaveBeenCalledTimes(2);
    expect(visits.updateOne.mock.calls[1][2]).toEqual({ upsert: false });
  });
  it('rejects invalid input before rate limiting and fails closed when Redis is unavailable', async () => {
    await expect(
      service.record(id, { ...event, progress: 101 }),
    ).rejects.toThrow();
    expect(redis.eval).not.toHaveBeenCalled();
    redis.status = 'reconnecting';
    await expect(service.record(id, event)).rejects.toThrow(
      'temporarily unavailable',
    );
    expect(stories.exists).not.toHaveBeenCalled();
  });
  it('retries racing first-tracking writes while preserving the earliest timestamp', async () => {
    tracking.updateOne.mockReturnValueOnce({
      exec: jest.fn().mockRejectedValue({ code: 11000 }),
    });
    await expect(service.record(id, event)).resolves.toMatchObject({
      success: true,
    });
    expect(tracking.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: 'readership' },
      { $min: { startedAt: new Date('2026-10-22T15:00:00Z') } },
      { upsert: false },
    );
  });
  it('rejects rate-limited and unpublished visits without writing telemetry', async () => {
    redis.eval.mockResolvedValue(0);
    await expect(service.record(id, event)).rejects.toThrow(
      'Too many story events',
    );
    expect(stories.exists).not.toHaveBeenCalled();
    redis.eval.mockResolvedValue(1);
    stories.exists.mockReturnValue({
      maxTimeMS: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(service.record(id, event)).rejects.toThrow(
      'Shipment story not found',
    );
    expect(visits.updateOne).not.toHaveBeenCalled();
  });
  it('returns a UTC calendar range with zero-filled days and stable tracking start', async () => {
    const report = await service.report({ storyIds: id, days: '7' });
    expect(report.data).toMatchObject({
      days: 7,
      from: '2026-10-16T00:00:00.000Z',
      to: '2026-10-22T15:00:00.000Z',
      trackingStartedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(report.data.stories[0]).toMatchObject({
      storyId: id,
      opens: 0,
      engaged: 0,
      completed: 0,
    });
    expect(report.data.stories[0].daily).toHaveLength(7);
    expect(report.data.stories[0].daily[0].date).toBe('2026-10-16');
    expect(report.data.stories[0].daily[6].date).toBe('2026-10-22');
  });
  it('sums persisted metrics by the first-open date', async () => {
    visits.aggregate.mockReturnValue({
      option: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: { storyId: id, date: '2026-10-22' },
          opens: 3,
          engaged: 2,
          completed: 1,
        },
      ]),
    });
    const report = await service.report({ days: '7' }, id);
    expect(report.data.stories[0]).toMatchObject({
      opens: 3,
      engaged: 2,
      completed: 1,
    });
    expect(report.data.stories[0].daily[6]).toEqual({
      date: '2026-10-22',
      opens: 3,
      engaged: 2,
      completed: 1,
    });
  });
});
