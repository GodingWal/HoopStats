/**
 * Simple in-memory cache with TTL support
 */

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

class MemoryCache {
    private cache: Map<string, CacheEntry<unknown>> = new Map();
    private defaultTTL: number;

    constructor(defaultTTLMs: number = 5 * 60 * 1000) { // Default 5 minutes
        this.defaultTTL = defaultTTLMs;
    }

    /**
     * Get a cached value
     */
    get<T>(key: string): T | null {
        const entry = this.cache.get(key) as CacheEntry<T> | undefined;

        if (!entry) {
            return null;
        }

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Set a cached value with optional custom TTL
     */
    set<T>(key: string, data: T, ttlMs?: number): void {
        const expiresAt = Date.now() + (ttlMs ?? this.defaultTTL);
        this.cache.set(key, { data, expiresAt });
    }

    /**
     * Check if a key exists and is not expired
     */
    has(key: string): boolean {
        return this.get(key) !== null;
    }

    /**
     * Delete a specific key
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all cached entries
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache stats
     */
    stats(): { size: number; keys: string[] } {
        // Clean up expired entries first
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }

        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys()),
        };
    }
}

// Export singleton instances with different TTLs
export const apiCache = new MemoryCache(5 * 60 * 1000);  // 5 minute cache for API responses
export const shortCache = new MemoryCache(60 * 1000);   // 1 minute cache for live data

export { MemoryCache };
