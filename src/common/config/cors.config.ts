import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

type Environment = Record<string, string | undefined>;

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Invalid CORS origin: ${origin}`);
      }
      return url.origin;
    });
}

function getAllowedOrigins(environment: Environment): string[] {
  const configuredOrigins = [
    ...parseOrigins(environment.CORS_ORIGINS),
    ...parseOrigins(environment.FRONTEND_URL),
  ];

  if (environment.NODE_ENV === 'production' && configuredOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGINS or FRONTEND_URL must be configured in production',
    );
  }

  const origins =
    environment.NODE_ENV === 'production'
      ? configuredOrigins
      : [...configuredOrigins, ...DEVELOPMENT_ORIGINS];

  return [...new Set(origins)];
}

export function createCorsOptions(
  environment: Environment = process.env,
): CorsOptions {
  const allowedOrigins = getAllowedOrigins(environment);

  return {
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS'), false);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  };
}
