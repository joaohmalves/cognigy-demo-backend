import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
  message?: string;
}

const buckets = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 60_000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();

export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    max,
    keyFn,
    message,
  } = options;

  return function rateLimiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const identifier = keyFn(req);

    const key = `${req.baseUrl}${req.path}:${identifier}`;

    const now = Date.now();

    const existingBucket = buckets.get(key);

    if (
      !existingBucket ||
      existingBucket.resetAt <= now
    ) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      return next();
    }

    if (existingBucket.count >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (existingBucket.resetAt - now) / 1000,
        ),
      );

      res.setHeader(
        'Retry-After',
        String(retryAfterSeconds),
      );

      return res.status(429).json({
        error:
          message ??
          'Muitas tentativas. Tente novamente mais tarde.',
        retryAfterSeconds,
      });
    }

    existingBucket.count += 1;

    return next();
  };
}