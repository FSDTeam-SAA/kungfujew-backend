import { BadRequestException } from '@nestjs/common';
import { SERVICE_LINES, SHIPMENT_STATUSES } from './content.schemas';

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
  }
  if (typeof result.slug === 'string') result.slug = result.slug.toLowerCase();
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
            new URL(queryText(result[field])).protocol,
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
    result.faqs = faqs.map((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('question' in item) ||
        !('answer' in item) ||
        typeof item.question !== 'string' ||
        typeof item.answer !== 'string' ||
        !item.question.trim() ||
        !item.answer.trim()
      )
        throw new BadRequestException(
          'Each FAQ requires a question and answer',
        );
      return { question: item.question.trim(), answer: item.answer.trim() };
    });
  }
  return result;
}

export function queryText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string')
    throw new BadRequestException('Query parameters must be strings');
  return value.trim();
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
