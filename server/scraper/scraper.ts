/**
 * Main Scraper Class
 * Combines all anti-detection features into a unified scraper
 * Uses undici for proper proxy support
 */

import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { ProxyManager } from "./proxy-manager";
import { UserAgentRotator } from "./user-agent-rotator";
import { RateLimiter } from "./rate-limiter";
import type { ScraperConfig, ScraperResponse, RequestOptions, ProxyConfig, ScraperStats } from "./types";

// Default configuration
const DEFAULT_CONFIG: Required<ScraperConfig> = {
    proxies: [],
    useProxies: false,
    proxyRotationStrategy: "round-robin",
    maxProxyFailures: 3,

    requestsPerMinute: 30,
    requestsPerSecond: 2,
    minDelayMs: 500,
    maxDelayMs: 3000,

    maxRetries: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
    maxRetryDelayMs: 30000,
    retryableStatuses: [408, 429, 500, 502, 503, 504],

    rotateUserAgent: true,
    randomizeHeaders: true,
    addJitter: true,
    jitterPercent: 30,

    timeoutMs: 30000,
    connectionTimeoutMs: 10000,

    persistCookies: false,
    sessionId: "",
};

export class Scraper {
    private config: Required<ScraperConfig>;
    private proxyManager: ProxyManager;
    private userAgentRotator: UserAgentRotator;
    private rateLimiter: RateLimiter;

    // Stats tracking
    private totalRequests: number = 0;
    private successfulRequests: number = 0;
    private failedRequests: number = 0;
    private totalRetries: number = 0;
    private responseTimes: number[] = [];

    // Cookie jar (simple implementation)
    private cookies: Map<string, string> = new Map();

    constructor(config: ScraperConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Initialize components
        this.proxyManager = new ProxyManager(
            this.config.proxies,
            this.config.proxyRotationStrategy,
            this.config.maxProxyFailures
        );

        this.userAgentRotator = new UserAgentRotator(
            this.config.rotateUserAgent ? "random" : "round-robin"
        );

        this.rateLimiter = new RateLimiter({
            requestsPerMinute: this.config.requestsPerMinute,
            requestsPerSecond: this.config.requestsPerSecond,
            minDelayMs: this.config.minDelayMs,
            maxDelayMs: this.config.maxDelayMs,
            addJitter: this.config.addJitter,
            jitterPercent: this.config.jitterPercent,
        });
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Calculate exponential backoff delay
     */
    private calculateBackoff(attempt: number): number {
        const delay = this.config.retryDelayMs * Math.pow(this.config.retryBackoffMultiplier, attempt);
        const jitter = this.config.addJitter ? Math.random() * 0.3 * delay : 0;
        return Math.min(delay + jitter, this.config.maxRetryDelayMs);
    }

    /**
     * Build request headers with anti-detection features
     */
    private buildHeaders(options: RequestOptions = {}, profile: ReturnType<UserAgentRotator["getNext"]>): Record<string, string> {
        const headers: Record<string, string> = {
            // Browser headers from user agent profile
            ...this.userAgentRotator.getHeaders(profile),

            // Standard request headers
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",

            // Custom headers from options
            ...(options.headers || {}),
        };

        // Add Sec-Fetch headers for Chromium browsers
        if (profile.secChUa) {
            headers["Sec-Fetch-Dest"] = "empty";
            headers["Sec-Fetch-Mode"] = "cors";
            headers["Sec-Fetch-Site"] = "cross-site";
        }

        // Add cookies if persisting
        if (this.config.persistCookies && this.cookies.size > 0) {
            headers["Cookie"] = Array.from(this.cookies.entries())
                .map(([k, v]) => `${k}=${v}`)
                .join("; ");
        }

        // Randomize header order for anti-fingerprinting
        if (this.config.randomizeHeaders) {
            const entries = Object.entries(headers);
            for (let i = entries.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [entries[i], entries[j]] = [entries[j], entries[i]];
            }
            return Object.fromEntries(entries);
        }

        return headers;
    }

    /**
     * Parse Set-Cookie headers and store cookies
     */
    private parseCookies(setCookieHeader: string | null): void {
        if (!setCookieHeader || !this.config.persistCookies) return;

        // Simple cookie parsing (doesn't handle all edge cases)
        const cookies = setCookieHeader.split(",").map(c => c.trim());
        for (const cookie of cookies) {
            const [nameValue] = cookie.split(";");
            const [name, value] = nameValue.split("=");
            if (name && value) {
                this.cookies.set(name.trim(), value.trim());
            }
        }
    }

    /**
     * Create a proxy agent for the given proxy config
     */
    private createProxyAgent(proxy: ProxyConfig): ProxyAgent {
        const proxyUrl = this.proxyManager.getProxyUrl(proxy);
        return new ProxyAgent({
            uri: proxyUrl,
            // Connection timeout
            connectTimeout: this.config.connectionTimeoutMs,
        });
    }

    /**
     * Make a single request attempt
     */
    private async makeRequest(
        url: string,
        options: RequestOptions,
        profile: ReturnType<UserAgentRotator["getNext"]>,
        proxy?: ProxyConfig | null
    ): Promise<Response> {
        const headers = this.buildHeaders(options, profile);

        const fetchOptions: UndiciRequestInit = {
            method: options.method || "GET",
            headers,
            redirect: options.followRedirects !== false ? "follow" : "manual",
        };

        if (options.body) {
            fetchOptions.body = typeof options.body === "string"
                ? options.body
                : JSON.stringify(options.body);

            if (typeof options.body === "object" && !headers["Content-Type"]) {
                headers["Content-Type"] = "application/json";
            }
        }

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            options.timeout || this.config.timeoutMs
        );
        fetchOptions.signal = controller.signal;

        try {
            let response: Response;

            // Use proxy if configured and available
            if (proxy && this.config.useProxies) {
                const proxyAgent = this.createProxyAgent(proxy);
                fetchOptions.dispatcher = proxyAgent;
                console.log(`[Scraper] Using proxy: ${proxy.host}:${proxy.port}`);
                response = await undiciFetch(url, fetchOptions) as unknown as Response;
            } else {
                // Direct request without proxy
                response = await undiciFetch(url, fetchOptions) as unknown as Response;
            }

            clearTimeout(timeoutId);

            // Store cookies from response
            this.parseCookies(response.headers.get("set-cookie"));

            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * Main fetch method with retry logic and rate limiting
     */
    async fetch(url: string, options: RequestOptions = {}): Promise<ScraperResponse> {
        const startTime = Date.now();
        let attempts = 0;
        let lastError: Error | null = null;
        let proxyUsed: ProxyConfig | undefined;

        // Get user agent profile for this request
        const profile = this.userAgentRotator.getNext();

        // Use rate limiter to schedule the request
        return this.rateLimiter.schedule(async () => {
            this.totalRequests++;

            for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
                attempts++;

                // Get a proxy if configured
                const proxy = this.config.useProxies ? this.proxyManager.getNext() : null;
                if (proxy) proxyUsed = proxy;

                try {
                    const response = await this.makeRequest(url, options, profile, proxy);

                    // Check if we should retry
                    if (!response.ok && this.config.retryableStatuses.includes(response.status)) {
                        // Mark proxy failure if used
                        if (proxy) this.proxyManager.markFailure(proxy);

                        if (attempt < this.config.maxRetries) {
                            this.totalRetries++;
                            const delay = this.calculateBackoff(attempt);
                            console.log(`[Scraper] Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${this.config.maxRetries + 1})`);
                            await this.sleep(delay);
                            continue;
                        }
                    }

                    // Mark proxy success if used
                    if (proxy && response.ok) {
                        this.proxyManager.markSuccess(proxy);
                    }

                    // Track stats
                    const elapsed = Date.now() - startTime;
                    this.responseTimes.push(elapsed);
                    if (this.responseTimes.length > 100) {
                        this.responseTimes = this.responseTimes.slice(-100);
                    }

                    if (response.ok) {
                        this.successfulRequests++;
                    } else {
                        this.failedRequests++;
                    }

                    // Build response
                    const body = await response.text();
                    const headers: Record<string, string> = {};
                    response.headers.forEach((value, key) => {
                        headers[key] = value;
                    });

                    return {
                        ok: response.ok,
                        status: response.status,
                        statusText: response.statusText,
                        headers,
                        body,
                        json: <T = unknown>() => JSON.parse(body) as T,
                        attempts,
                        totalTimeMs: elapsed,
                        proxyUsed,
                        userAgentUsed: profile.userAgent,
                    };

                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    // Mark proxy failure if used
                    if (proxy) this.proxyManager.markFailure(proxy);

                    if (attempt < this.config.maxRetries) {
                        this.totalRetries++;
                        const delay = this.calculateBackoff(attempt);
                        console.log(`[Scraper] Network error, retrying in ${Math.round(delay)}ms: ${lastError.message}`);
                        await this.sleep(delay);
                    }
                }
            }

            this.failedRequests++;
            throw lastError || new Error("All retry attempts failed");
        });
    }

    /**
     * Convenience method for GET requests
     */
    async get(url: string, options: Omit<RequestOptions, "method"> = {}): Promise<ScraperResponse> {
        return this.fetch(url, { ...options, method: "GET" });
    }

    /**
     * Convenience method for POST requests
     */
    async post(url: string, body?: string | object, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<ScraperResponse> {
        return this.fetch(url, { ...options, method: "POST", body });
    }

    /**
     * Add proxies to the pool
     */
    addProxies(proxies: ProxyConfig[] | string[]): void {
        if (typeof proxies[0] === "string") {
            this.proxyManager.loadFromStrings(proxies as string[]);
        } else {
            this.proxyManager.addProxies(proxies as ProxyConfig[]);
        }
        this.config.useProxies = this.proxyManager.hasProxies();
    }

    /**
     * Get scraper statistics
     */
    getStats(): ScraperStats {
        const avgResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0;

        return {
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            totalRetries: this.totalRetries,
            averageResponseTimeMs: Math.round(avgResponseTime),
            proxyStats: this.proxyManager.getStats(),
        };
    }

    /**
     * Get rate limiter stats
     */
    getRateLimiterStats() {
        return this.rateLimiter.getStats();
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<ScraperConfig>): void {
        this.config = { ...this.config, ...config };

        if (config.requestsPerMinute !== undefined || config.requestsPerSecond !== undefined ||
            config.minDelayMs !== undefined || config.maxDelayMs !== undefined) {
            this.rateLimiter.updateSettings({
                requestsPerMinute: this.config.requestsPerMinute,
                requestsPerSecond: this.config.requestsPerSecond,
                minDelayMs: this.config.minDelayMs,
                maxDelayMs: this.config.maxDelayMs,
            });
        }
    }

    /**
     * Clear cookies
     */
    clearCookies(): void {
        this.cookies.clear();
    }

    /**
     * Reset failed proxies
     */
    resetFailedProxies(): void {
        this.proxyManager.resetAllFailed();
    }

    /**
     * Reset all statistics
     */
    resetStats(): void {
        this.totalRequests = 0;
        this.successfulRequests = 0;
        this.failedRequests = 0;
        this.totalRetries = 0;
        this.responseTimes = [];
        this.userAgentRotator.resetStats();
    }
}

/**
 * Factory function to create a scraper instance
 */
export function createScraper(config: ScraperConfig = {}): Scraper {
    return new Scraper(config);
}
