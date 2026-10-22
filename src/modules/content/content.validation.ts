import { BadRequestException } from '@nestjs/common';
import { SERVICE_LINES, SHIPMENT_STATUSES } from './content.schemas';

const STORY_TEXT_LIMITS: Record<string, number> = {
  title: 200,
  slug: 200,
  metaDescription: 500,
  content: 500000,
  pickupLocation: 200,
  destination: 200,
  shipmentType: 200,
  image: 2048,
  imageAlt: 500,
};

export function booleanValue(value: unknown): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new BadRequestException('isPublished must be true or false');
}

export function contentInput(
  body: Record<string, unknown>,
  kind: 'story' | 'project',
  creating: boolean,
) {
  const required =
    kind === 'story'
      ? [
          'title',
          'slug',
          'metaDescription',
          'content',
          'pickupLocation',
          'destination',
          'shipmentType',
          'serviceLine',
        ]
      : ['name', 'type'];
  const optional =
    kind === 'story'
      ? ['shipmentStatus', 'image', 'imageAlt']
      : ['figmaLink', 'websiteLink', 'adminLink', 'category', 'profile'];
  const result: Record<string, unknown> = {};
  for (const field of [...required, ...optional]) {
    const value = body[field];
    if (value === undefined) {
      if (creating && required.includes(field))
        throw new BadRequestException(`${field} is required`);
      continue;
    }
    if (
      typeof value !== 'string' ||
      (required.includes(field) && !value.trim())
    )
      throw new BadRequestException(`Invalid ${field}`);
    result[field] = value.trim();
    if (kind === 'story' && value.length > (STORY_TEXT_LIMITS[field] ?? 200))
      throw new BadRequestException(`${field} is too long`);
  }
  if (typeof result.slug === 'string') {
    result.slug = result.slug.toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(queryText(result.slug)))
      throw new BadRequestException(
        'Slug must contain letters, numbers and single hyphens',
      );
  }
  if (
    kind === 'story' &&
    typeof result.content === 'string' &&
    !result.content
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
      .trim()
  )
    throw new BadRequestException('Story content must include text');
  if (typeof result.serviceLine === 'string') {
    result.serviceLine = result.serviceLine.toLowerCase();
    if (!SERVICE_LINES.includes(queryText(result.serviceLine)))
      throw new BadRequestException('Invalid serviceLine');
  }
  if (
    result.shipmentStatus !== undefined &&
    !SHIPMENT_STATUSES.includes(queryText(result.shipmentStatus))
  )
    throw new BadRequestException('Invalid shipmentStatus');
  if (
    result.type !== undefined &&
    !['web', 'app'].includes(queryText(result.type))
  )
    throw new BadRequestException('Invalid project type');
  for (const field of ['figmaLink', 'websiteLink', 'adminLink', 'image']) {
    if (result[field]) {
      try {
        if (
          !['http:', 'https:'].includes(
            new URL(queryText(result[field], 2048)).protocol,
          )
        )
          throw new Error();
      } catch {
        throw new BadRequestException(`${field} must be an HTTP or HTTPS URL`);
      }
    }
  }
  if (kind === 'story' && body.isPublished !== undefined)
    result.isPublished = booleanValue(body.isPublished);
  if (kind === 'story' && body.coverPosition !== undefined) {
    let position: unknown = body.coverPosition;
    if (typeof position === 'string') {
      try {
        position = JSON.parse(position);
      } catch {
        throw new BadRequestException('Invalid cover position JSON');
      }
    }
    if (
      !position ||
      typeof position !== 'object' ||
      Array.isArray(position) ||
      !('x' in position) ||
      !('y' in position) ||
      ![position.x, position.y].every(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 100,
      )
    )
      throw new BadRequestException(
        'Cover position requires x and y percentages from 0 to 100',
      );
    result.coverPosition = { x: position.x, y: position.y };
  }
  if (kind === 'story' && body.faqs !== undefined) {
    let faqs: unknown = body.faqs;
    if (typeof faqs === 'string') {
      try {
        faqs = JSON.parse(faqs);
      } catch {
        throw new BadRequestException('Invalid FAQ JSON');
      }
    }
    if (!Array.isArray(faqs))
      throw new BadRequestException('FAQs must be an array');
    if (faqs.length > 20)
      throw new BadRequestException('A story can contain up to 20 FAQs');
    result.faqs = faqs.map((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('question' in item) ||
        !('answer' in item) ||
        typeof item.question !== 'string' ||
        typeof item.answer !== 'string' ||
        !item.question.trim() ||
        !item.answer.trim() ||
        item.question.length > 300 ||
        item.answer.length > 10000
      )
        throw new BadRequestException(
          'Each FAQ requires a question and answer',
        );
      return { question: item.question.trim(), answer: item.answer.trim() };
    });
  }
  return result;
}

export function queryText(value: unknown, maxLength = 200): string {
  if (value === undefined) return '';
  if (typeof value !== 'string')
    throw new BadRequestException('Query parameters must be strings');
  if (value.length > maxLength)
    throw new BadRequestException(
      `Text must be at most ${maxLength} characters`,
    );
  return value.trim();
}

export function validateStoryImage(file?: Express.Multer.File): void {
  if (!file || !file.buffer?.length || file.buffer.length > 10 * 1024 * 1024)
    throw new BadRequestException('Provide an image up to 10 MiB');
  const bytes = file.buffer;
  const header = bytes.subarray(0, 12);
  const boxLength = bytes.length >= 16 ? bytes.readUInt32BE(0) : 0;
  const avifBrandOffset = bytes.indexOf('avif', 16, 'ascii');
  const avisBrandOffset = bytes.indexOf('avis', 16, 'ascii');
  const hasCompatibleAvifBrand = [avifBrandOffset, avisBrandOffset].some(
    (offset) => offset >= 16 && offset % 4 === 0 && offset + 4 <= boxLength,
  );
  const signatures: Record<string, boolean> = {
    'image/jpeg': header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    'image/png': header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/gif': /^GIF8[79]a/.test(header.toString('ascii')),
    'image/webp':
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP',
    'image/avif':
      header.subarray(4, 8).toString('ascii') === 'ftyp' &&
      boxLength >= 16 &&
      boxLength <= bytes.length &&
      (['avif', 'avis'].includes(header.subarray(8, 12).toString('ascii')) ||
        hasCompatibleAvifBrand),
  };
  if (!signatures[file.mimetype])
    throw new BadRequestException(
      'Image contents must match JPEG, PNG, WebP, GIF or AVIF format',
    );
}

export function pagination(query: Record<string, unknown>) {
  const positive = (value: unknown, fallback: number, max: number) => {
    const parsed = Number.parseInt(queryText(value), 10);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, max)
      : fallback;
  };
  return {
    page: positive(query.page, 1, 1000000),
    limit: positive(query.limit, 10, 50),
  };
}

export const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
