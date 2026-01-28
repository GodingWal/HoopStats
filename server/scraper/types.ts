/**
 * Type definitions for the custom scraper
 */

export interface ProxyConfig {
    host: string;
    port: number;
    protocol: "http" | "https" | "socks4" | "socks5";
    username?: string;
    password?: string;
    country?: string;
    lastUsed?: number;
    failureCount?: number;
    successCount?: number;
}

export interface ScraperConfig {
    // Proxy settings
    proxies?: ProxyConfig[];
    useProxies?: boolean;
    proxyRotationStrategy?: "round-robin" | "random" | "least-used" | "least-failures";
    maxProxyFailures?: number;  // Remove proxy after N failures

    // Rate limiting
    requestsPerMinute?: number;
    requestsPerSecond?: number;
    minDelayMs?: number;
    maxDelayMs?: number;

    // Retry settings
    maxRetries?: number;
    retryDelayMs?: number;
    retryBackoffMultiplier?: number;
    maxRetryDelayMs?: number;
    retryableStatuses?: number[];

    // Anti-detection
    rotateUserAgent?: boolean;
    randomizeHeaders?: boolean;
    addJitter?: boolean;
    jitterPercent?: number;

    // Timeouts
    timeoutMs?: number;
    connectionTimeoutMs?: number;

    // Session
    persistCookies?: boolean;
    sessionId?: string;
}

export interface ScraperResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    json: <T = unknown>() => T;

    // Metadata
    attempts: number;
    totalTimeMs: number;
    proxyUsed?: ProxyConfig;
    userAgentUsed: string;
}

export interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    headers?: Record<string, string>;
    body?: string | object;
    timeout?: number;
    followRedirects?: boolean;
    maxRedirects?: number;
}

export interface ProxyStats {
    total: number;
    active: number;
    failed: number;
    successRate: number;
}

export interface ScraperStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalRetries: number;
    averageResponseTimeMs: number;
    proxyStats: ProxyStats;
}
