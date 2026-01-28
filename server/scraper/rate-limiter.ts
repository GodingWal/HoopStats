/**
 * Rate Limiter
 * Handles request rate limiting with queuing and configurable delays
 */

interface QueuedRequest {
    id: string;
    execute: () => Promise<void>;
    resolve: (value: void) => void;
    reject: (reason: unknown) => void;
    addedAt: number;
}

export class RateLimiter {
    private requestsPerMinute: number;
    private requestsPerSecond: number;
    private minDelayMs: number;
    private maxDelayMs: number;
    private addJitter: boolean;
    private jitterPercent: number;

    private requestTimestamps: number[];
    private queue: QueuedRequest[];
    private processing: boolean;
    private lastRequestTime: number;

    constructor(options: {
        requestsPerMinute?: number;
        requestsPerSecond?: number;
        minDelayMs?: number;
        maxDelayMs?: number;
        addJitter?: boolean;
        jitterPercent?: number;
    } = {}) {
        this.requestsPerMinute = options.requestsPerMinute || 30;
        this.requestsPerSecond = options.requestsPerSecond || 2;
        this.minDelayMs = options.minDelayMs || 500;
        this.maxDelayMs = options.maxDelayMs || 3000;
        this.addJitter = options.addJitter ?? true;
        this.jitterPercent = options.jitterPercent || 30;

        this.requestTimestamps = [];
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
    }

    /**
     * Calculate delay with optional jitter
     */
    private calculateDelay(): number {
        let delay = this.minDelayMs;

        // Check per-second rate
        const oneSecondAgo = Date.now() - 1000;
        const recentRequests = this.requestTimestamps.filter(t => t > oneSecondAgo);
        if (recentRequests.length >= this.requestsPerSecond) {
            const oldestRecent = Math.min(...recentRequests);
            delay = Math.max(delay, 1000 - (Date.now() - oldestRecent) + 100);
        }

        // Check per-minute rate
        const oneMinuteAgo = Date.now() - 60000;
        const minuteRequests = this.requestTimestamps.filter(t => t > oneMinuteAgo);
        if (minuteRequests.length >= this.requestsPerMinute) {
            const oldestMinute = Math.min(...minuteRequests);
            delay = Math.max(delay, 60000 - (Date.now() - oldestMinute) + 100);
        }

        // Add jitter to avoid patterns
        if (this.addJitter) {
            const jitterRange = delay * (this.jitterPercent / 100);
            const jitter = (Math.random() - 0.5) * 2 * jitterRange;
            delay = Math.max(this.minDelayMs, delay + jitter);
        }

        return Math.min(delay, this.maxDelayMs);
    }

    /**
     * Clean up old timestamps
     */
    private cleanup(): void {
        const oneMinuteAgo = Date.now() - 60000;
        this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process the request queue
     */
    private async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const request = this.queue.shift();
            if (!request) continue;

            try {
                // Calculate and wait for appropriate delay
                const delay = this.calculateDelay();
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;

                if (timeSinceLastRequest < delay) {
                    await this.sleep(delay - timeSinceLastRequest);
                }

                // Record timestamp and execute
                this.lastRequestTime = Date.now();
                this.requestTimestamps.push(this.lastRequestTime);

                await request.execute();
                request.resolve();
            } catch (error) {
                request.reject(error);
            }

            // Cleanup old timestamps periodically
            if (this.requestTimestamps.length > 100) {
                this.cleanup();
            }
        }

        this.processing = false;
    }

    /**
     * Schedule a request to be executed with rate limiting
     */
    async schedule<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let result: T;

            const request: QueuedRequest = {
                id: Math.random().toString(36).substring(7),
                execute: async () => {
                    result = await fn();
                },
                resolve: () => resolve(result),
                reject,
                addedAt: Date.now(),
            };

            this.queue.push(request);
            this.processQueue();
        });
    }

    /**
     * Check if we can make a request immediately
     */
    canRequestNow(): boolean {
        const delay = this.calculateDelay();
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        return timeSinceLastRequest >= delay;
    }

    /**
     * Get time until next request can be made
     */
    getTimeUntilNextRequest(): number {
        const delay = this.calculateDelay();
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        return Math.max(0, delay - timeSinceLastRequest);
    }

    /**
     * Get queue length
     */
    getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Get statistics
     */
    getStats(): {
        queueLength: number;
        requestsLastMinute: number;
        requestsLastSecond: number;
        canRequestNow: boolean;
        timeUntilNextMs: number;
    } {
        this.cleanup();
        const oneSecondAgo = Date.now() - 1000;

        return {
            queueLength: this.queue.length,
            requestsLastMinute: this.requestTimestamps.length,
            requestsLastSecond: this.requestTimestamps.filter(t => t > oneSecondAgo).length,
            canRequestNow: this.canRequestNow(),
            timeUntilNextMs: this.getTimeUntilNextRequest(),
        };
    }

    /**
     * Clear the queue (cancel pending requests)
     */
    clearQueue(): number {
        const cleared = this.queue.length;
        this.queue.forEach(req => {
            req.reject(new Error("Queue cleared"));
        });
        this.queue = [];
        return cleared;
    }

    /**
     * Update rate limit settings
     */
    updateSettings(options: {
        requestsPerMinute?: number;
        requestsPerSecond?: number;
        minDelayMs?: number;
        maxDelayMs?: number;
    }): void {
        if (options.requestsPerMinute !== undefined) {
            this.requestsPerMinute = options.requestsPerMinute;
        }
        if (options.requestsPerSecond !== undefined) {
            this.requestsPerSecond = options.requestsPerSecond;
        }
        if (options.minDelayMs !== undefined) {
            this.minDelayMs = options.minDelayMs;
        }
        if (options.maxDelayMs !== undefined) {
            this.maxDelayMs = options.maxDelayMs;
        }
    }
}
