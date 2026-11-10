export interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitConfig {
  capacity: number;
  refillPerSecond: number;
}

const HIGH_FREQ_EVENTS = new Set(['yjs:update', 'awareness:update', 'yjs:sync-step1']);

const HIGH_FREQ_CONFIG: RateLimitConfig = {
  capacity: 120,
  refillPerSecond: 60,
};

const CONTROL_EVENT_CONFIG: RateLimitConfig = {
  capacity: 30,
  refillPerSecond: 15,
};

export class SocketRateLimiter {
  private buckets = new Map<string, TokenBucketState>();

  public consume(socketId: string, eventName: string, cost = 1): boolean {
    const isHighFreq = HIGH_FREQ_EVENTS.has(eventName);
    const bucketKey = `${socketId}:${isHighFreq ? 'hf' : 'ctrl'}`;
    const config = isHighFreq ? HIGH_FREQ_CONFIG : CONTROL_EVENT_CONFIG;

    const now = Date.now();
    let bucket = this.buckets.get(bucketKey);

    if (!bucket) {
      bucket = {
        tokens: config.capacity,
        lastRefillMs: now,
      };
      this.buckets.set(bucketKey, bucket);
    }

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefillMs) / 1000);
    if (elapsedSeconds > 0) {
      bucket.tokens = Math.min(
        config.capacity,
        bucket.tokens + elapsedSeconds * config.refillPerSecond
      );
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens < cost) {
      return false;
    }

    bucket.tokens -= cost;
    return true;
  }

  public removeSocket(socketId: string): void {
    this.buckets.delete(`${socketId}:hf`);
    this.buckets.delete(`${socketId}:ctrl`);
  }
}

export const socketRateLimiter = new SocketRateLimiter();
