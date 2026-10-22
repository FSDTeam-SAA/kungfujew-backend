import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import { SERVICE_LINES, Story } from './content.schemas';
import { StoryTracking, StoryVisit } from './story-analytics.schemas';
import { analyticsQuery, storyEvent } from './story-analytics.validation';

const DAY_MS = 86400000;
// One atomic fixed window bounds database work across all website proxies.
const RATE_LIMIT = `
  local global = redis.call('INCR', KEYS[1])
  if global == 1 then redis.call('EXPIRE', KEYS[1], 60) end
  if global > 6000 then return 0 end
  local visit = redis.call('INCR', KEYS[2])
  if visit == 1 then redis.call('EXPIRE', KEYS[2], 60) end
  if visit > 12 then return 0 end
  return 1
`;

type DailyMetrics = {
  date: string;
  opens: number;
  engaged: number;
  completed: number;
};
type AggregateRow = Omit<DailyMetrics, 'date'> & {
  _id: { storyId: Types.ObjectId; date: string };
};

function isDuplicateKey(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 11000
  );
}

@Injectable()
export class StoryAnalyticsService {
  constructor(
    @InjectModel('StoryVisit') private readonly visits: Model<StoryVisit>,
    @InjectModel('StoryTracking')
    private readonly tracking: Model<StoryTracking>,
    @InjectModel('RealShipmentStory') private readonly stories: Model<Story>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async record(id: string, body: unknown) {
    const event = storyEvent(id, body);
    await this.rateLimit(event.viewId);
    const published = await this.stories
      .exists({
        _id: id,
        isPublished: true,
        serviceLine: { $in: SERVICE_LINES },
      })
      .maxTimeMS(5000)
      .exec();
    if (!published) throw new NotFoundException('Shipment story not found');

    const now = new Date();
    const filter = { storyId: new Types.ObjectId(id), viewId: event.viewId };
    const update = {
      $setOnInsert: {
        openedAt: now,
        expiresAt: new Date(now.getTime() + 90 * DAY_MS),
      },
      $max: {
        stage:
          event.event === 'complete' ? 2 : event.event === 'engaged' ? 1 : 0,
      },
    };
    try {
      await this.visits.updateOne(filter, update, { upsert: true }).exec();
    } catch (error: unknown) {
      // Concurrent first events can race on the unique index; apply the same
      // monotonic stage update to the winning visit rather than inserting again.
      if (!isDuplicateKey(error)) throw error;
      await this.visits.updateOne(filter, update, { upsert: false }).exec();
    }
    try {
      await this.tracking
        .updateOne(
          { _id: 'readership' },
          { $min: { startedAt: now } },
          { upsert: true },
        )
        .exec();
    } catch (error: unknown) {
      if (!isDuplicateKey(error)) throw error;
      await this.tracking
        .updateOne(
          { _id: 'readership' },
          { $min: { startedAt: now } },
          { upsert: false },
        )
        .exec();
    }
    return { success: true, data: { accepted: true } };
  }

  private async rateLimit(viewId: string) {
    if (this.redis.status !== 'ready')
      throw new ServiceUnavailableException(
        'Story readership temporarily unavailable',
      );
    let accepted: unknown;
    try {
      accepted = await this.redis.eval(
        RATE_LIMIT,
        2,
        'story-events:{readership}:global',
        `story-events:{readership}:visit:${viewId}`,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Story readership temporarily unavailable',
      );
    }
    if (accepted !== 1)
      throw new HttpException(
        'Too many story events',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  async report(query: Record<string, unknown>, id?: string) {
    const { days, storyIds } = analyticsQuery(query, id);
    const now = new Date();
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        (days - 1) * DAY_MS,
    );
    const [rows, tracking] = await Promise.all([
      this.visits
        .aggregate<AggregateRow>([
          {
            $match: {
              storyId: {
                $in: storyIds.map((value) => new Types.ObjectId(value)),
              },
              openedAt: { $gte: from, $lte: now },
            },
          },
          {
            $group: {
              _id: {
                storyId: '$storyId',
                date: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$openedAt',
                    timezone: 'UTC',
                  },
                },
              },
              opens: { $sum: 1 },
              engaged: { $sum: { $cond: [{ $gte: ['$stage', 1] }, 1, 0] } },
              completed: { $sum: { $cond: [{ $gte: ['$stage', 2] }, 1, 0] } },
            },
          },
        ])
        .option({ maxTimeMS: 5000 })
        .exec(),
      this.tracking.findById('readership').lean().exec(),
    ]);
    const indexed = new Map(
      rows.map((row) => [`${String(row._id.storyId)}:${row._id.date}`, row]),
    );
    return {
      success: true,
      data: {
        days,
        from: from.toISOString(),
        to: now.toISOString(),
        trackingStartedAt: tracking?.startedAt?.toISOString() ?? null,
        stories: storyIds.map((storyId) => {
          const daily: DailyMetrics[] = Array.from(
            { length: days },
            (_, offset) => {
              const date = new Date(from.getTime() + offset * DAY_MS)
                .toISOString()
                .slice(0, 10);
              const row = indexed.get(`${storyId}:${date}`);
              return {
                date,
                opens: row?.opens ?? 0,
                engaged: row?.engaged ?? 0,
                completed: row?.completed ?? 0,
              };
            },
          );
          return {
            storyId,
            opens: daily.reduce((total, day) => total + day.opens, 0),
            engaged: daily.reduce((total, day) => total + day.engaged, 0),
            completed: daily.reduce((total, day) => total + day.completed, 0),
            daily,
          };
        }),
      },
    };
  }
}
