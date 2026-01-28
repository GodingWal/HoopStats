/**
 * Proxy Manager
 * Handles proxy rotation, health checking, and failure tracking
 */

import type { ProxyConfig, ProxyStats } from "./types";

export class ProxyManager {
    private proxies: ProxyConfig[];
    private currentIndex: number;
    private strategy: "round-robin" | "random" | "least-used" | "least-failures";
    private maxFailures: number;
    private failedProxies: Set<string>;

    constructor(
        proxies: ProxyConfig[] = [],
        strategy: "round-robin" | "random" | "least-used" | "least-failures" = "round-robin",
        maxFailures: number = 3
    ) {
        this.proxies = proxies.map(p => ({
            ...p,
            lastUsed: 0,
            failureCount: 0,
            successCount: 0,
        }));
        this.currentIndex = 0;
        this.strategy = strategy;
        this.maxFailures = maxFailures;
        this.failedProxies = new Set();
    }

    /**
     * Get the proxy key for tracking
     */
    private getProxyKey(proxy: ProxyConfig): string {
        return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
    }

    /**
     * Get active proxies (not failed)
     */
    private getActiveProxies(): ProxyConfig[] {
        return this.proxies.filter(p => !this.failedProxies.has(this.getProxyKey(p)));
    }

    /**
     * Get the next proxy based on the rotation strategy
     */
    getNext(): ProxyConfig | null {
        const active = this.getActiveProxies();
        if (active.length === 0) return null;

        let proxy: ProxyConfig;

        switch (this.strategy) {
            case "round-robin":
                this.currentIndex = this.currentIndex % active.length;
                proxy = active[this.currentIndex];
                this.currentIndex++;
                break;

            case "random":
                proxy = active[Math.floor(Math.random() * active.length)];
                break;

            case "least-used":
                proxy = active.reduce((min, p) =>
                    (p.lastUsed || 0) < (min.lastUsed || 0) ? p : min
                );
                break;

            case "least-failures":
                proxy = active.reduce((min, p) =>
                    (p.failureCount || 0) < (min.failureCount || 0) ? p : min
                );
                break;

            default:
                proxy = active[0];
        }

        // Update last used timestamp
        proxy.lastUsed = Date.now();
        return proxy;
    }

    /**
     * Mark a proxy as successful
     */
    markSuccess(proxy: ProxyConfig): void {
        const found = this.proxies.find(p => this.getProxyKey(p) === this.getProxyKey(proxy));
        if (found) {
            found.successCount = (found.successCount || 0) + 1;
            // Reset failure count on success
            found.failureCount = Math.max(0, (found.failureCount || 0) - 1);
        }
    }

    /**
     * Mark a proxy as failed
     */
    markFailure(proxy: ProxyConfig): void {
        const key = this.getProxyKey(proxy);
        const found = this.proxies.find(p => this.getProxyKey(p) === key);
        if (found) {
            found.failureCount = (found.failureCount || 0) + 1;

            // Remove proxy if max failures exceeded
            if (found.failureCount >= this.maxFailures) {
                this.failedProxies.add(key);
                console.warn(`[ProxyManager] Proxy ${key} disabled after ${this.maxFailures} failures`);
            }
        }
    }

    /**
     * Add a proxy to the pool
     */
    addProxy(proxy: ProxyConfig): void {
        const key = this.getProxyKey(proxy);
        if (!this.proxies.find(p => this.getProxyKey(p) === key)) {
            this.proxies.push({
                ...proxy,
                lastUsed: 0,
                failureCount: 0,
                successCount: 0,
            });
        }
    }

    /**
     * Add multiple proxies
     */
    addProxies(proxies: ProxyConfig[]): void {
        proxies.forEach(p => this.addProxy(p));
    }

    /**
     * Remove a proxy from the pool
     */
    removeProxy(proxy: ProxyConfig): void {
        const key = this.getProxyKey(proxy);
        this.proxies = this.proxies.filter(p => this.getProxyKey(p) !== key);
        this.failedProxies.delete(key);
    }

    /**
     * Reset a failed proxy (give it another chance)
     */
    resetProxy(proxy: ProxyConfig): void {
        const key = this.getProxyKey(proxy);
        const found = this.proxies.find(p => this.getProxyKey(p) === key);
        if (found) {
            found.failureCount = 0;
            this.failedProxies.delete(key);
        }
    }

    /**
     * Reset all failed proxies
     */
    resetAllFailed(): void {
        this.failedProxies.clear();
        this.proxies.forEach(p => {
            p.failureCount = 0;
        });
    }

    /**
     * Get proxy URL string
     */
    getProxyUrl(proxy: ProxyConfig): string {
        let auth = "";
        if (proxy.username && proxy.password) {
            auth = `${proxy.username}:${proxy.password}@`;
        }
        return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
    }

    /**
     * Parse a proxy string into ProxyConfig
     */
    static parseProxyString(proxyStr: string): ProxyConfig | null {
        try {
            // Format: protocol://user:pass@host:port or protocol://host:port
            const url = new URL(proxyStr);
            return {
                protocol: url.protocol.replace(":", "") as ProxyConfig["protocol"],
                host: url.hostname,
                port: parseInt(url.port) || 80,
                username: url.username || undefined,
                password: url.password || undefined,
            };
        } catch {
            // Try simple format: host:port
            const parts = proxyStr.split(":");
            if (parts.length === 2) {
                return {
                    protocol: "http",
                    host: parts[0],
                    port: parseInt(parts[1]),
                };
            }
            return null;
        }
    }

    /**
     * Load proxies from a list of strings
     */
    loadFromStrings(proxyStrings: string[]): number {
        let loaded = 0;
        for (const str of proxyStrings) {
            const proxy = ProxyManager.parseProxyString(str.trim());
            if (proxy) {
                this.addProxy(proxy);
                loaded++;
            }
        }
        return loaded;
    }

    /**
     * Get statistics
     */
    getStats(): ProxyStats {
        const active = this.getActiveProxies();
        const totalSuccess = this.proxies.reduce((sum, p) => sum + (p.successCount || 0), 0);
        const totalFailure = this.proxies.reduce((sum, p) => sum + (p.failureCount || 0), 0);
        const total = totalSuccess + totalFailure;

        return {
            total: this.proxies.length,
            active: active.length,
            failed: this.failedProxies.size,
            successRate: total > 0 ? totalSuccess / total : 0,
        };
    }

    /**
     * Check if any proxies are available
     */
    hasProxies(): boolean {
        return this.getActiveProxies().length > 0;
    }

    /**
     * Get all proxies (for debugging)
     */
    getAllProxies(): ProxyConfig[] {
        return [...this.proxies];
    }
}
