/**
 * Custom Web Scraper with anti-detection features
 * Built to replace paid services like ScraperAPI
 *
 * Features:
 * - Proxy rotation (free proxy lists or custom proxies)
 * - User-agent rotation
 * - Rate limiting with request queuing
 * - Retry logic with exponential backoff
 * - Anti-detection headers and fingerprinting
 * - Session management
 */

export { Scraper, createScraper } from "./scraper";
export { ProxyManager } from "./proxy-manager";
export { UserAgentRotator } from "./user-agent-rotator";
export { RateLimiter } from "./rate-limiter";
export type { ScraperConfig, ScraperResponse, ProxyConfig, ScraperStats } from "./types";
