/**
 * API utility functions with retry logic and error handling
 */

import { apiLogger } from "./logger";

interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    timeoutMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    timeoutMs: 30000,
};

/**
 * Sleep for a specified duration
 */
const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay
 */
const getBackoffDelay = (attempt: number, baseDelay: number, maxDelay: number): number => {
    const delay = baseDelay * Math.pow(2, attempt - 1);
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, maxDelay);
};

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Fetch with automatic retry on failure
 */
export async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
): Promise<Response> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            const response = await fetchWithTimeout(url, options, opts.timeoutMs);

            // Don't retry on client errors (4xx) except 429 (rate limit)
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                return response;
            }

            // Retry on server errors (5xx) or rate limiting (429)
            if (response.status >= 500 || response.status === 429) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const isAbort = lastError.name === 'AbortError';
            const isLastAttempt = attempt === opts.maxAttempts;

            apiLogger.warn(`Fetch attempt ${attempt}/${opts.maxAttempts} failed`, {
                url,
                error: lastError.message,
                isTimeout: isAbort,
            });

            if (isLastAttempt) {
                break;
            }

            const delay = getBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
            await sleep(delay);
        }
    }

    throw lastError ?? new Error('Fetch failed after retries');
}

/**
 * Safely parse JSON with error handling
 */
export async function safeJsonParse<T>(response: Response): Promise<T | null> {
    try {
        const text = await response.text();
        if (!text) return null;
        return JSON.parse(text) as T;
    } catch (error) {
        apiLogger.error('Failed to parse JSON response', error);
        return null;
    }
}

/**
 * Generic API fetcher with caching support
 */
export async function apiFetch<T>(
    url: string,
    options: RequestInit = {},
    retryOptions?: RetryOptions
): Promise<T | null> {
    try {
        const response = await fetchWithRetry(url, options, retryOptions);

        if (!response.ok) {
            apiLogger.warn(`API request failed: ${response.status}`, { url });
            return null;
        }

        return await safeJsonParse<T>(response);
    } catch (error) {
        apiLogger.error('API request error', error, { url });
        return null;
    }
}
