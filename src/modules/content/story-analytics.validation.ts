import { BadRequestException } from '@nestjs/common';

export type StoryEvent = {
  viewId: string;
  event: 'open' | 'engaged' | 'complete';
  activeSeconds: number;
  progress: number;
};

export function storyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value))
    throw new BadRequestException('Invalid story ID');
  return value.toLowerCase();
}

export function storyEvent(id: string, body: unknown): StoryEvent {
  storyId(id);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid story event');
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !['viewId', 'event', 'activeSeconds', 'progress'].includes(key),
    ) ||
    typeof value.viewId !== 'string' ||
    !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      value.viewId,
    ) ||
    typeof value.event !== 'string' ||
    !['open', 'engaged', 'complete'].includes(value.event) ||
    typeof value.activeSeconds !== 'number' ||
    !Number.isFinite(value.activeSeconds) ||
    value.activeSeconds < 0 ||
    value.activeSeconds > 86400 ||
    typeof value.progress !== 'number' ||
    !Number.isFinite(value.progress) ||
    value.progress < 0 ||
    value.progress > 100 ||
    (value.event !== 'open' && value.activeSeconds < 30) ||
    (value.event === 'complete' && value.progress < 90)
  )
    throw new BadRequestException('Invalid story event evidence');
  return {
    viewId: value.viewId.toLowerCase(),
    event: value.event as StoryEvent['event'],
    activeSeconds: value.activeSeconds,
    progress: value.progress,
  };
}

export function analyticsQuery(query: Record<string, unknown>, id?: string) {
  const requestedDays = query.days === undefined ? '30' : query.days;
  if (
    typeof requestedDays !== 'string' ||
    !['7', '30', '90'].includes(requestedDays)
  )
    throw new BadRequestException('Analytics days must be 7, 30 or 90');
  const days = Number(requestedDays);
  if (
    !id &&
    (typeof query.storyIds !== 'string' || query.storyIds.length > 1249)
  )
    throw new BadRequestException('Provide up to 50 story IDs');
  const requested = id ? [id] : (query.storyIds as string).split(',');
  if (requested.length > 50)
    throw new BadRequestException('Provide up to 50 story IDs');
  return { days, storyIds: [...new Set(requested.map(storyId))] };
}
