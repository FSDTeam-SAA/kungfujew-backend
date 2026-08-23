import { createCorsOptions } from './cors.config';

describe('createCorsOptions', () => {
  it('allows configured dashboard origins and bearer-token headers', (done) => {
    const options = createCorsOptions({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://dashboard.example.com',
    });

    expect(options.credentials).toBe(false);
    expect(options.allowedHeaders).toEqual(
      expect.arrayContaining(['Authorization', 'Content-Type']),
    );

    expect(typeof options.origin).toBe('function');
    if (typeof options.origin !== 'function') {
      throw new Error('Expected a CORS origin callback');
    }

    options.origin('https://dashboard.example.com', (error, allowed) => {
      expect(error).toBeNull();
      expect(allowed).toBe(true);
      done();
    });
  });

  it('rejects unknown browser origins in production', (done) => {
    const options = createCorsOptions({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://dashboard.example.com',
    });

    if (typeof options.origin !== 'function') {
      throw new Error('Expected a CORS origin callback');
    }

    options.origin('https://unknown.example.com', (error, allowed) => {
      expect(error).toBeInstanceOf(Error);
      expect(allowed).toBe(false);
      done();
    });
  });

  it('requires an explicit production origin', () => {
    expect(() =>
      createCorsOptions({ NODE_ENV: 'production' }),
    ).toThrow('CORS_ORIGINS or FRONTEND_URL must be configured in production');
  });
});
