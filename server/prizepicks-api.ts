/**
 * PrizePicks API client for fetching real player prop lines
 * @note This is an unofficial API - may break or get blocked
 * Uses ScraperAPI to bypass Cloudflare protection with enhanced anti-detection
 */

import { apiCache } from "./cache";
import { apiLogger } from "./logger";

const PRIZEPICKS_API_BASE = "https://api.prizepicks.com";
const SCRAPERAPI_BASE = "https://api.scraperapi.com";
const NBA_LEAGUE_ID = 7;

// ScraperAPI configuration
interface ScraperApiConfig {
    apiKey: string;
    premium: boolean;           // Use premium residential proxies
    render: boolean;            // Enable JavaScript rendering
    countryCode: string;        // Geo-targeting (US for PrizePicks)
    deviceType: "desktop" | "mobile";
    sessionNumber?: number;     // Session persistence for consistent IPs
    keepHeaders: boolean;       // Pass custom headers to target
    autoparse: boolean;         // Auto-parse JSON responses
}

// Retry configuration
interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableStatuses: [403, 408, 429, 500, 502, 503, 504],
};

// Session management for consistent proxy IPs
let currentSessionNumber = Math.floor(Math.random() * 1000000);
let sessionRequestCount = 0;
const MAX_REQUESTS_PER_SESSION = 10; // Rotate session after 10 requests

/**
 * Get ScraperAPI key from environment
 */
function getScraperApiKey(): string | null {
    return process.env.SCRAPER_API_KEY || null;
}

/**
 * Check if ScraperAPI is configured
 */
export function isScraperApiConfigured(): boolean {
    return !!getScraperApiKey();
}

/**
 * Check if premium ScraperAPI features are enabled
 */
function isPremiumEnabled(): boolean {
    return process.env.SCRAPER_API_PREMIUM === "true";
}

/**
 * Check if JS rendering is enabled
 */
function isRenderEnabled(): boolean {
    return process.env.SCRAPER_API_RENDER === "true";
}

/**
 * Get or rotate session number for consistent proxy IPs
 */
function getSessionNumber(): number {
    sessionRequestCount++;
    if (sessionRequestCount >= MAX_REQUESTS_PER_SESSION) {
        currentSessionNumber = Math.floor(Math.random() * 1000000);
        sessionRequestCount = 0;
        apiLogger.debug("Rotated ScraperAPI session", { newSession: currentSessionNumber });
    }
    return currentSessionNumber;
}

/**
 * Build ScraperAPI URL with all configuration options
 */
function buildScraperApiUrl(targetUrl: string, config: Partial<ScraperApiConfig> = {}): string {
    const apiKey = getScraperApiKey();
    if (!apiKey) throw new Error("ScraperAPI key not configured");

    const params = new URLSearchParams({
        api_key: apiKey,
        url: targetUrl,
        // Anti-detection features
        premium: config.premium ?? isPremiumEnabled() ? "true" : "false",
        render: config.render ?? isRenderEnabled() ? "true" : "false",
        country_code: config.countryCode ?? "us",
        device_type: config.deviceType ?? "desktop",
        // Session persistence for consistent IP
        session_number: String(config.sessionNumber ?? getSessionNumber()),
        // Header passthrough
        keep_headers: config.keepHeaders ?? true ? "true" : "false",
    });

    return `${SCRAPERAPI_BASE}?${params.toString()}`;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(
    url: string,
    options: RequestInit,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            // Success or non-retryable error
            if (response.ok || !retryConfig.retryableStatuses.includes(response.status)) {
                return response;
            }

            // Retryable error
            const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
            apiLogger.warn(`ScraperAPI request failed (attempt ${attempt + 1}/${retryConfig.maxRetries + 1})`, {
                status: response.status,
                url: url.substring(0, 100), // Truncate for logging
            });

            lastError = new Error(errorMsg);

            // Don't retry on last attempt
            if (attempt < retryConfig.maxRetries) {
                const delay = calculateBackoffDelay(attempt, retryConfig);
                apiLogger.debug(`Retrying in ${Math.round(delay)}ms...`);
                await sleep(delay);

                // Rotate session on 403 errors (likely IP blocked)
                if (response.status === 403) {
                    currentSessionNumber = Math.floor(Math.random() * 1000000);
                    sessionRequestCount = 0;
                    apiLogger.info("Rotated session due to 403 block");
                }
            }
        } catch (error) {
            // Network error
            lastError = error instanceof Error ? error : new Error(String(error));
            apiLogger.warn(`Network error (attempt ${attempt + 1}/${retryConfig.maxRetries + 1})`, {
                error: lastError.message,
            });

            if (attempt < retryConfig.maxRetries) {
                const delay = calculateBackoffDelay(attempt, retryConfig);
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error("All retry attempts failed");
}

// Browser-like headers (used for all requests)
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
    "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Connection": "keep-alive",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
};

// PrizePicks stat type mapping
const STAT_TYPE_MAP: Record<string, string> = {
    "Points": "PTS",
    "Rebounds": "REB",
    "Assists": "AST",
    "3-Pointers Made": "FG3M",
    "Pts+Rebs+Asts": "PRA",
    "Steals": "STL",
    "Blocks": "BLK",
    "Turnovers": "TO",
    "Fantasy Score": "FPTS",
    "Pts+Rebs": "PR",
    "Pts+Asts": "PA",
    "Rebs+Asts": "RA",
};

export interface PrizePicksProjection {
    id: string;
    playerId: string;
    playerName: string;
    team: string;
    teamAbbr: string;
    position: string;
    statType: string;
    statTypeAbbr: string;
    line: number;
    gameTime: string;
    opponent: string;
    imageUrl?: string;
}

interface PrizePicksApiResponse {
    data: {
        id: string;
        type: string;
        attributes: {
            line_score: number;
            stat_type: string;
            start_time: string;
            status: string;
            odds_type: string;
            game_id: string;
            description?: string;
            is_promo?: boolean;
            flash_sale_line_score?: number;
        };
        relationships: {
            new_player: { data: { id: string; type: string } };
            league: { data: { id: string; type: string } };
            stat_type: { data: { id: string; type: string } };
        };
    }[];
    included: {
        id: string;
        type: string;
        attributes: {
            name?: string;
            display_name?: string;
            team?: string;
            team_name?: string;
            position?: string;
            image_url?: string;
            market?: string;
        };
    }[];
}

/**
 * Fetch with multiple fallback strategies
 * Tries: 1) ScraperAPI with premium, 2) ScraperAPI standard, 3) Direct request
 */
async function fetchWithFallback(targetUrl: string): Promise<Response> {
    const scraperApiKey = getScraperApiKey();
    const strategies: Array<{ name: string; getConfig: () => { url: string; options: RequestInit } }> = [];

    if (scraperApiKey) {
        // Strategy 1: ScraperAPI with premium features (if enabled)
        if (isPremiumEnabled()) {
            strategies.push({
                name: "ScraperAPI Premium",
                getConfig: () => ({
                    url: buildScraperApiUrl(targetUrl, { premium: true, render: isRenderEnabled() }),
                    options: { method: "GET", headers: HEADERS },
                }),
            });
        }

        // Strategy 2: ScraperAPI standard
        strategies.push({
            name: "ScraperAPI Standard",
            getConfig: () => ({
                url: buildScraperApiUrl(targetUrl, { premium: false, render: false }),
                options: { method: "GET", headers: HEADERS },
            }),
        });

        // Strategy 3: ScraperAPI with JS rendering (useful for Cloudflare challenges)
        if (!isRenderEnabled()) {
            strategies.push({
                name: "ScraperAPI with Render",
                getConfig: () => ({
                    url: buildScraperApiUrl(targetUrl, { premium: false, render: true }),
                    options: { method: "GET", headers: HEADERS },
                }),
            });
        }
    }

    // Strategy 4: Direct request (fallback, likely blocked but worth trying)
    strategies.push({
        name: "Direct Request",
        getConfig: () => ({
            url: targetUrl,
            options: { method: "GET", headers: HEADERS },
        }),
    });

    let lastError: Error | null = null;

    for (const strategy of strategies) {
        try {
            const config = strategy.getConfig();
            apiLogger.info(`Trying fetch strategy: ${strategy.name}`, {
                targetUrl: targetUrl.substring(0, 80)
            });

            const response = await fetchWithRetry(config.url, config.options, {
                ...DEFAULT_RETRY_CONFIG,
                maxRetries: 2, // Fewer retries per strategy since we have fallbacks
            });

            if (response.ok) {
                apiLogger.info(`Fetch succeeded with strategy: ${strategy.name}`);
                return response;
            }

            // If we got a response but it's an error, log and try next strategy
            lastError = new Error(`${strategy.name} failed: HTTP ${response.status}`);
            apiLogger.warn(`Strategy ${strategy.name} returned ${response.status}, trying next...`);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            apiLogger.warn(`Strategy ${strategy.name} failed: ${lastError.message}`);
        }
    }

    throw lastError || new Error("All fetch strategies failed");
}

/**
 * Fetch NBA projections from PrizePicks
 */
export async function fetchPrizePicksProjections(): Promise<PrizePicksProjection[]> {
    const cacheKey = "prizepicks-nba-projections";
    const cached = apiCache.get<PrizePicksProjection[]>(cacheKey);
    if (cached) {
        apiLogger.debug("Cache hit for PrizePicks projections");
        return cached;
    }

    try {
        const targetUrl = `${PRIZEPICKS_API_BASE}/projections?league_id=${NBA_LEAGUE_ID}&per_page=250&single_stat=true`;

        apiLogger.info("Fetching PrizePicks projections", {
            targetUrl,
            scraperApiConfigured: isScraperApiConfigured(),
            premiumEnabled: isPremiumEnabled(),
            renderEnabled: isRenderEnabled(),
        });

        const response = await fetchWithFallback(targetUrl);

        if (!response.ok) {
            const errorMsg = isScraperApiConfigured()
                ? `PrizePicks blocked (${response.status}) - all strategies failed. Consider enabling premium proxies with SCRAPER_API_PREMIUM=true`
                : "PrizePicks blocked - configure SCRAPER_API_KEY in .env to bypass Cloudflare";
            apiLogger.warn(errorMsg);
            throw new Error(errorMsg);
        }

        const data: PrizePicksApiResponse = await response.json();

        // Debug: Log sample of raw data to find standard line indicator
        console.log(`[PrizePicks] Received ${data.data?.length || 0} projections, ${data.included?.length || 0} included items`);
        if (data.data && data.data.length > 0) {
            // Log unique odds_type values to find standard vs goblin/demon
            const oddsTypes = new Set(data.data.map(p => p.attributes.odds_type));
            console.log(`[PrizePicks] Unique odds_type values:`, Array.from(oddsTypes));

            // Log samples with odds_type
            const samples = data.data.slice(0, 5);
            for (const s of samples) {
                console.log(`[PrizePicks] Sample: line=${s.attributes.line_score}, stat=${s.attributes.stat_type}, odds_type=${s.attributes.odds_type}, is_promo=${s.attributes.is_promo}`);
            }
        }

        // Build lookup maps for included data
        const players = new Map<string, { name: string; team: string; position: string; imageUrl?: string }>();
        const statTypes = new Map<string, string>();

        for (const item of data.included || []) {
            if (item.type === "new_player") {
                players.set(item.id, {
                    name: item.attributes.display_name || item.attributes.name || "Unknown",
                    team: item.attributes.team || item.attributes.team_name || "",
                    position: item.attributes.position || "",
                    imageUrl: item.attributes.image_url,
                });
            } else if (item.type === "stat_type") {
                statTypes.set(item.id, item.attributes.name || "");
            }
        }

        // Transform projections
        const projections: PrizePicksProjection[] = [];

        for (const proj of data.data || []) {
            if (proj.attributes.status !== "pre_game") continue; // Only show upcoming

            // Filter out demon/goblin lines - only show standard lines
            const oddsType = (proj.attributes.odds_type || "").toLowerCase();
            if (oddsType !== "standard" && oddsType !== "") {
                continue; // Skip demon, goblin, and other alternate lines
            }

            const playerId = proj.relationships?.new_player?.data?.id;
            const statTypeId = proj.relationships?.stat_type?.data?.id;

            const player = players.get(playerId);
            const statType = statTypes.get(statTypeId) || proj.attributes.stat_type;

            if (!player) continue;

            projections.push({
                id: proj.id,
                playerId,
                playerName: player.name,
                team: player.team,
                teamAbbr: getTeamAbbr(player.team),
                position: player.position,
                statType: statType,
                statTypeAbbr: STAT_TYPE_MAP[statType] || statType,
                line: proj.attributes.flash_sale_line_score || proj.attributes.line_score,
                gameTime: proj.attributes.start_time,
                opponent: proj.attributes.description || "",
                imageUrl: player.imageUrl,
            });
        }

        apiLogger.info("Fetched PrizePicks projections", { count: projections.length });

        // Cache for 10 minutes
        apiCache.set(cacheKey, projections, 10 * 60 * 1000);

        return projections;
    } catch (error) {
        apiLogger.error("Failed to fetch PrizePicks projections", error);
        throw error;
    }
}

// Helper to normalize player names for comparison
function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\./g, "")      // Remove dots (C.J. -> cj)
        .replace(/'/g, "")       // Remove apostrophes (O'Neale -> oneale)
        .replace(/jr\.?|sr\.?|iii|ii|iv/g, "") // Remove suffixes
        .replace(/[^a-z0-9\s]/g, "") // Remove other special chars
        .trim()
        .replace(/\s+/g, " ");   // Normalize whitespace
}

/**
 * Get projections for a specific player
 */
export async function fetchPlayerPrizePicksProps(playerName: string): Promise<PrizePicksProjection[]> {
    const allProjections = await fetchPrizePicksProjections();

    const searchName = normalizeName(playerName);

    // Split search name into parts for fuzzy matching if needed
    const searchParts = searchName.split(" ");

    return allProjections.filter(p => {
        const propName = normalizeName(p.playerName);

        // 1. Exact match after normalization
        if (propName === searchName) {
            return true;
        }

        // 2. Contains match (e.g. "Luka Doncic" matches "Luka Doncic (Probable)")
        if (propName.includes(searchName) || searchName.includes(propName)) {
            // Be careful with short names, but generally safe for full names
            if (searchName.length > 4) return true;
        }

        // 3. Last name + First initial match (common in sports data)
        // Not robust enough alone, usually handled by database sync, 
        // but simple "LeBron James" vs "James, LeBron" check

        // 4. Part Matching
        // Ensure all parts of the shorter name are present in the longer name
        const propParts = propName.split(" ");

        // If we have at least 2 parts (First Last)
        if (searchParts.length >= 2 && propParts.length >= 2) {
            // Check if first part matches
            const firstMatch = propParts[0] === searchParts[0];
            // Check if last part matches (last element of array)
            const lastMatch = propParts[propParts.length - 1] === searchParts[searchParts.length - 1];

            if (firstMatch && lastMatch) return true;
        }

        return false;
    });
}

/**
 * Get projections grouped by game
 */
export async function fetchPrizePicksByGame(): Promise<Map<string, PrizePicksProjection[]>> {
    const projections = await fetchPrizePicksProjections();
    const byGame = new Map<string, PrizePicksProjection[]>();

    for (const proj of projections) {
        const gameKey = proj.gameTime;
        if (!byGame.has(gameKey)) {
            byGame.set(gameKey, []);
        }
        byGame.get(gameKey)!.push(proj);
    }

    return byGame;
}

// Helper to get team abbreviation
function getTeamAbbr(teamName: string): string {
    const abbrs: Record<string, string> = {
        "Lakers": "LAL", "Clippers": "LAC", "Warriors": "GSW", "Kings": "SAC", "Suns": "PHX",
        "Nuggets": "DEN", "Jazz": "UTA", "Trail Blazers": "POR", "Thunder": "OKC", "Timberwolves": "MIN",
        "Grizzlies": "MEM", "Pelicans": "NOP", "Spurs": "SAS", "Rockets": "HOU", "Mavericks": "DAL",
        "Celtics": "BOS", "Nets": "BKN", "Knicks": "NYK", "76ers": "PHI", "Raptors": "TOR",
        "Bulls": "CHI", "Cavaliers": "CLE", "Pistons": "DET", "Pacers": "IND", "Bucks": "MIL",
        "Hawks": "ATL", "Hornets": "CHA", "Heat": "MIA", "Magic": "ORL", "Wizards": "WAS",
        "Los Angeles Lakers": "LAL", "Los Angeles Clippers": "LAC", "Golden State Warriors": "GSW",
        "Sacramento Kings": "SAC", "Phoenix Suns": "PHX", "Denver Nuggets": "DEN", "Utah Jazz": "UTA",
        "Portland Trail Blazers": "POR", "Oklahoma City Thunder": "OKC", "Minnesota Timberwolves": "MIN",
        "Memphis Grizzlies": "MEM", "New Orleans Pelicans": "NOP", "San Antonio Spurs": "SAS",
        "Houston Rockets": "HOU", "Dallas Mavericks": "DAL", "Boston Celtics": "BOS",
        "Brooklyn Nets": "BKN", "New York Knicks": "NYK", "Philadelphia 76ers": "PHI",
        "Toronto Raptors": "TOR", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
        "Detroit Pistons": "DET", "Indiana Pacers": "IND", "Milwaukee Bucks": "MIL",
        "Atlanta Hawks": "ATL", "Charlotte Hornets": "CHA", "Miami Heat": "MIA",
        "Orlando Magic": "ORL", "Washington Wizards": "WAS",
    };

    return abbrs[teamName] || teamName.substring(0, 3).toUpperCase();
}

/**
 * Get current scraper configuration status
 * Useful for debugging and health checks
 */
export interface ScraperStatus {
    configured: boolean;
    premiumEnabled: boolean;
    renderEnabled: boolean;
    currentSession: number;
    sessionRequestCount: number;
}

export function getScraperStatus(): ScraperStatus {
    return {
        configured: isScraperApiConfigured(),
        premiumEnabled: isPremiumEnabled(),
        renderEnabled: isRenderEnabled(),
        currentSession: currentSessionNumber,
        sessionRequestCount: sessionRequestCount,
    };
}

/**
 * Force rotate the scraper session
 * Call this if you suspect the current session is blocked
 */
export function rotateScraperSession(): number {
    currentSessionNumber = Math.floor(Math.random() * 1000000);
    sessionRequestCount = 0;
    apiLogger.info("Manually rotated ScraperAPI session", { newSession: currentSessionNumber });
    return currentSessionNumber;
}
