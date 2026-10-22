import { analyticsQuery, storyEvent } from './story-analytics.validation';

const storyId = '507f1f77bcf86cd799439011';
const open = {
  viewId: '2fb2fcb4-4801-49ad-820d-6d3a94df8d76',
  event: 'open',
  activeSeconds: 0,
  progress: 0,
};

describe('story readership input boundaries', () => {
  it('accepts valid visits and requires evidence for engagement and completion', () => {
    expect(storyEvent(storyId, open)).toEqual(open);
    expect(() =>
      storyEvent(storyId, { ...open, event: 'engaged', activeSeconds: 29 }),
    ).toThrow();
    expect(() =>
      storyEvent(storyId, {
        ...open,
        event: 'complete',
        activeSeconds: 30,
        progress: 89,
      }),
    ).toThrow();
    expect(
      storyEvent(storyId, {
        ...open,
        event: 'complete',
        activeSeconds: 30,
        progress: 90,
      }).event,
    ).toBe('complete');
  });
  it('rejects invalid IDs, fields, unbounded values and unexpected payloads', () => {
    for (const body of [
      null,
      [],
      { ...open, userEmail: 'unwanted' },
      { ...open, viewId: 'bad' },
      { ...open, event: 'other' },
      { ...open, activeSeconds: Infinity },
      { ...open, progress: '90' },
      { ...open, progress: 101 },
    ])
      expect(() => storyEvent(storyId, body)).toThrow();
    expect(() => storyEvent('bad', open)).toThrow();
  });
  it('defaults reporting to 30 days and bounds/deduplicates story batches', () => {
    expect(analyticsQuery({ storyIds: `${storyId},${storyId}` })).toEqual({
      days: 30,
      storyIds: [storyId],
    });
    for (const query of [
      { storyIds: storyId, days: '14' },
      { storyIds: '' },
      { storyIds: 'bad' },
      { storyIds: Array.from({ length: 51 }, () => storyId).join(',') },
    ])
      expect(() => analyticsQuery(query)).toThrow();
  });
});
