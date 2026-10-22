import {
  booleanValue,
  contentInput,
  escapeRegex,
  pagination,
  queryText,
  validateStoryImage,
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
  it('validates cover percentages from JSON and multipart without coercion', () => {
    expect(
      contentInput({ coverPosition: '{"x":0,"y":100}' }, 'story', false),
    ).toEqual({ coverPosition: { x: 0, y: 100 } });
    expect(contentInput({}, 'story', false)).not.toHaveProperty(
      'coverPosition',
    );
    for (const coverPosition of [
      null,
      [],
      '{',
      { x: '20', y: 10 },
      { x: NaN, y: 10 },
      { x: -1, y: 10 },
      { x: 20, y: 101 },
    ])
      expect(() => contentInput({ coverPosition }, 'story', false)).toThrow();
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

  it('rejects unreachable slugs, empty editor markup and excessive content', () => {
    for (const slug of ['a/b', 'a?b', 'a b', '-story', 'story-'])
      expect(() => contentInput({ ...story, slug }, 'story', true)).toThrow();
    for (const content of ['<p><br></p>', '<p>&nbsp; &#160;</p>'])
      expect(() =>
        contentInput({ ...story, content }, 'story', true),
      ).toThrow();
    expect(() =>
      contentInput({ ...story, title: 'x'.repeat(201) }, 'story', true),
    ).toThrow();
    expect(() =>
      contentInput(
        {
          faqs: Array.from({ length: 21 }, () => ({
            question: 'Q',
            answer: 'A',
          })),
        },
        'story',
        false,
      ),
    ).toThrow();
  });

  it('rejects disguised and oversized images before calling the provider', () => {
    const file = (buffer: Buffer, mimetype = 'image/png') =>
      ({ buffer, mimetype }) as Express.Multer.File;
    expect(() =>
      validateStoryImage(file(Buffer.from('<script>bad</script>'))),
    ).toThrow();
    expect(() =>
      validateStoryImage(file(Buffer.alloc(10 * 1024 * 1024 + 1))),
    ).toThrow();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    expect(() => validateStoryImage(file(png))).not.toThrow();
    expect(() => validateStoryImage(file(png, 'image/jpeg'))).toThrow();
    expect(() => queryText('x'.repeat(201))).toThrow();
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypmif1'),
      Buffer.alloc(4),
      Buffer.from('avifmif1'),
    ]);
    expect(() => validateStoryImage(file(avif, 'image/avif'))).not.toThrow();
  });
});
