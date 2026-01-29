/**
 * User Agent Rotator
 * Maintains a pool of realistic browser user agents and rotates through them
 */

interface UserAgentProfile {
    userAgent: string;
    platform: string;
    mobile: boolean;
    secChUa: string;
    secChUaMobile: string;
    secChUaPlatform: string;
}

// Modern browser user agents (updated January 2026)
const USER_AGENT_PROFILES: UserAgentProfile[] = [
    // Chrome 131 on Windows (most common)
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        platform: "Windows",
        mobile: false,
        secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        secChUaMobile: "?0",
        secChUaPlatform: '"Windows"',
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        platform: "Windows",
        mobile: false,
        secChUa: '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        secChUaMobile: "?0",
        secChUaPlatform: '"Windows"',
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        platform: "Windows",
        mobile: false,
        secChUa: '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
        secChUaMobile: "?0",
        secChUaPlatform: '"Windows"',
    },
    // Chrome on Mac
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        platform: "macOS",
        mobile: false,
        secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        secChUaMobile: "?0",
        secChUaPlatform: '"macOS"',
    },
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        platform: "macOS",
        mobile: false,
        secChUa: '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        secChUaMobile: "?0",
        secChUaPlatform: '"macOS"',
    },
    // Firefox on Windows
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        platform: "Windows",
        mobile: false,
        secChUa: "",
        secChUaMobile: "",
        secChUaPlatform: "",
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
        platform: "Windows",
        mobile: false,
        secChUa: "",
        secChUaMobile: "",
        secChUaPlatform: "",
    },
    // Firefox on Mac
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
        platform: "macOS",
        mobile: false,
        secChUa: "",
        secChUaMobile: "",
        secChUaPlatform: "",
    },
    // Edge on Windows
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        platform: "Windows",
        mobile: false,
        secChUa: '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        secChUaMobile: "?0",
        secChUaPlatform: '"Windows"',
    },
    // Safari on Mac
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
        platform: "macOS",
        mobile: false,
        secChUa: "",
        secChUaMobile: "",
        secChUaPlatform: "",
    },
    // Chrome on Linux
    {
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        platform: "Linux",
        mobile: false,
        secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        secChUaMobile: "?0",
        secChUaPlatform: '"Linux"',
    },
];

export class UserAgentRotator {
    private profiles: UserAgentProfile[];
    private currentIndex: number;
    private strategy: "round-robin" | "random" | "weighted";
    private usageCount: Map<number, number>;

    constructor(strategy: "round-robin" | "random" | "weighted" = "random") {
        this.profiles = [...USER_AGENT_PROFILES];
        this.currentIndex = 0;
        this.strategy = strategy;
        this.usageCount = new Map();

        // Initialize usage counts
        for (let i = 0; i < this.profiles.length; i++) {
            this.usageCount.set(i, 0);
        }
    }

    /**
     * Get the next user agent profile
     */
    getNext(): UserAgentProfile {
        let index: number;

        switch (this.strategy) {
            case "round-robin":
                index = this.currentIndex;
                this.currentIndex = (this.currentIndex + 1) % this.profiles.length;
                break;

            case "weighted":
                // Prefer less-used profiles
                const minUsage = Math.min(...this.usageCount.values());
                const leastUsed = Array.from(this.usageCount.entries())
                    .filter(([_, count]) => count === minUsage)
                    .map(([idx]) => idx);
                index = leastUsed[Math.floor(Math.random() * leastUsed.length)];
                break;

            case "random":
            default:
                index = Math.floor(Math.random() * this.profiles.length);
                break;
        }

        this.usageCount.set(index, (this.usageCount.get(index) || 0) + 1);
        return this.profiles[index];
    }

    /**
     * Get a random user agent string
     */
    getRandomUserAgent(): string {
        return this.getNext().userAgent;
    }

    /**
     * Get full headers for the current profile
     */
    getHeaders(profile?: UserAgentProfile): Record<string, string> {
        const p = profile || this.getNext();
        const headers: Record<string, string> = {
            "User-Agent": p.userAgent,
        };

        // Add sec-ch-ua headers for Chromium-based browsers
        if (p.secChUa) {
            headers["Sec-Ch-Ua"] = p.secChUa;
            headers["Sec-Ch-Ua-Mobile"] = p.secChUaMobile;
            headers["Sec-Ch-Ua-Platform"] = p.secChUaPlatform;
        }

        return headers;
    }

    /**
     * Add a custom user agent profile
     */
    addProfile(profile: UserAgentProfile): void {
        this.profiles.push(profile);
        this.usageCount.set(this.profiles.length - 1, 0);
    }

    /**
     * Get statistics
     */
    getStats(): { total: number; usageCounts: Record<string, number> } {
        const usageCounts: Record<string, number> = {};
        this.usageCount.forEach((count, idx) => {
            const ua = this.profiles[idx]?.userAgent.substring(0, 50) + "...";
            usageCounts[ua] = count;
        });
        return {
            total: this.profiles.length,
            usageCounts,
        };
    }

    /**
     * Reset usage statistics
     */
    resetStats(): void {
        this.usageCount.forEach((_, key) => {
            this.usageCount.set(key, 0);
        });
    }
}
