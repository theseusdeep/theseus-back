import { logger } from './utils/logger';

export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private queue: number[];

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.queue = [];
  }

  public async check(): Promise<void> {
    logger.debug("RateLimiter check initiated.", {
      maxRequests: this.maxRequests,
      windowMs: this.windowMs,
      currentQueueLength: this.queue.length,
    });

    while (true) {
      const now = Date.now();
      // Remove requests older than windowMs
      while (this.queue.length && (now - (this.queue[0] ?? 0)) > this.windowMs) {
        this.queue.shift();
      }
      if (this.queue.length < this.maxRequests) {
        this.queue.push(now);
        logger.debug("RateLimiter check passed.", { newQueueLength: this.queue.length });
        return;
      } else {
        const firstTimestamp = this.queue[0] ?? 0;
        const waitTime = this.windowMs - (now - firstTimestamp);
        logger.warn(`Rate limit exceeded. Waiting for ${waitTime / 1000} seconds before proceeding.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
}
