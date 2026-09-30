import {
  booleanValue,
  contentInput,
  escapeRegex,
  pagination,
} from './content.validation';

describe('migrated content validation', () => {
  const story = {
    title: 'A move',
    slug: ' A-MOVE ',
    metaDescription: 'Description',
    content: '<p>Story</p>',
    pickupLocation: 'Austin',
    destination: 'Boston',
    shipmentType: 'Car',
    serviceLine: ' VEHICLE ',
  };
  it('normalizes slugs and service lines for multipart creates', () => {
    expect(
      contentInput(
        {
          ...story,
          isPublished: 'false',
          faqs: '[{"question":" Q ","answer":" A "}]',
        },
        'story',
        true,
      ),
    ).toMatchObject({
      slug: 'a-move',
      serviceLine: 'vehicle',
      isPublished: false,
      faqs: [{ question: 'Q', answer: 'A' }],
    });
  });
  it('preserves explicit clearing of images and FAQs', () => {
    expect(
      contentInput({ image: '', imageAlt: '', faqs: '[]' }, 'story', false),
    ).toEqual({ image: '', imageAlt: '', faqs: [] });
  });
  it('rejects malformed and missing required content', () => {
    expect(() =>
      contentInput({ ...story, serviceLine: '' }, 'story', true),
    ).toThrow();
    expect(() => contentInput({ faqs: '{' }, 'story', false)).toThrow();
    expect(() =>
      contentInput({ faqs: [{ question: '', answer: 'a' }] }, 'story', false),
    ).toThrow();
    expect(() =>
      contentInput({ title: { $ne: null } }, 'story', false),
    ).toThrow();
  });
  it('rejects unsafe project links and invalid booleans', () => {
    expect(() =>
      contentInput(
        { name: 'Project', type: 'web', websiteLink: 'javascript:alert(1)' },
        'project',
        true,
      ),
    ).toThrow();
    expect(() => booleanValue('yes')).toThrow();
    expect(booleanValue('false')).toBe(false);
  });
  it('bounds pagination and escapes literal searches', () => {
    expect(pagination({ page: '-1', limit: '5000' })).toEqual({
      page: 1,
      limit: 50,
    });
    expect(pagination({ page: 'bad', limit: '0' })).toEqual({
      page: 1,
      limit: 10,
    });
    expect(new RegExp(escapeRegex('car (SUV)+')).test('car (SUV)+')).toBe(true);
  });
});
