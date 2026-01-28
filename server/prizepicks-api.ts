/**
 * PrizePicks API client for fetching real player prop lines
 * @note This is an unofficial API - may break or get blocked
 * Uses custom scraper with anti-detection features (no paid services required)
 */

import { apiCache } from "./cache";
import { apiLogger } from "./logger";
import { createScraper, type Scraper, type ScraperStats } from "./scraper";

const PRIZEPICKS_API_BASE = "https://api.prizepicks.com";
const NBA_LEAGUE_ID = 7;

// Singleton scraper instance optimized for PrizePicks
let prizePicksScraper: Scraper | null = null;

/**
 * Get or create the PrizePicks scraper instance
 */
function getScraper(): Scraper {
    if (!prizePicksScraper) {
        prizePicksScraper = createScraper({
            // Rate limiting - be respectful to avoid blocks
            requestsPerMinute: 20,
            requestsPerSecond: 1,
            minDelayMs: 1000,
            maxDelayMs: 5000,

            // Retry settings
            maxRetries: 3,
            retryDelayMs: 2000,
            retryBackoffMultiplier: 2,
            maxRetryDelayMs: 30000,
            retryableStatuses: [403, 408, 429, 500, 502, 503, 504],

            // Anti-detection
            rotateUserAgent: true,
            randomizeHeaders: true,
            addJitter: true,
            jitterPercent: 30,

            // Timeouts
            timeoutMs: 30000,

            // Proxies (can be configured via addProxies)
            useProxies: false,
            proxyRotationStrategy: "least-failures",
            maxProxyFailures: 3,
        });

        // Load proxies from environment if configured
        const proxyList = process.env.PROXY_LIST;
        if (proxyList) {
            const proxies = proxyList.split(",").map(p => p.trim()).filter(Boolean);
            if (proxies.length > 0) {
                prizePicksScraper.addProxies(proxies);
                apiLogger.info(`Loaded ${proxies.length} proxies from PROXY_LIST`);
            }
        }
    }
    return prizePicksScraper;
}

// PrizePicks-specific headers
const PRIZEPICKS_HEADERS = {
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
    "Accept": "application/json",
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
        const scraper = getScraper();
        const targetUrl = `${PRIZEPICKS_API_BASE}/projections?league_id=${NBA_LEAGUE_ID}&per_page=250&single_stat=true`;

        apiLogger.info("Fetching PrizePicks projections with custom scraper", {
            targetUrl,
            stats: scraper.getStats(),
        });

        const response = await scraper.get(targetUrl, {
            headers: PRIZEPICKS_HEADERS,
        });

        if (!response.ok) {
            const errorMsg = `PrizePicks blocked (${response.status}) - try adding proxies via PROXY_LIST env var`;
            apiLogger.warn(errorMsg, {
                status: response.status,
                attempts: response.attempts,
                timeMs: response.totalTimeMs,
            });
            throw new Error(errorMsg);
        }

        const data = response.json<PrizePicksApiResponse>();

        // Debug: Log sample of raw data to find standard line indicator
        console.log(`[PrizePicks] Received ${data.data?.length || 0} projections, ${data.included?.length || 0} included items`);
        if (data.data && data.data.length > 0) {
            // Log unique odds_type values to find standard vs goblin/demon
            const oddsTypes = new Set(data.data.map(p => p.attributes.odds_type));
            console.log(`[PrizePicks] Unique odds_type values:`, Array.from(oddsTypes));
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

        apiLogger.info("Fetched PrizePicks projections", {
            count: projections.length,
            attempts: response.attempts,
            timeMs: response.totalTimeMs,
        });

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

        // 3. Part Matching
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
 * Scraper status interface
 */
export interface ScraperStatus extends ScraperStats {
    rateLimiter: {
        queueLength: number;
        requestsLastMinute: number;
        requestsLastSecond: number;
        canRequestNow: boolean;
        timeUntilNextMs: number;
    };
}

/**
 * Get current scraper configuration status
 * Useful for debugging and health checks
 */
export function getScraperStatus(): ScraperStatus {
    const scraper = getScraper();
    return {
        ...scraper.getStats(),
        rateLimiter: scraper.getRateLimiterStats(),
    };
}

/**
 * Add proxies to the scraper
 * @param proxies Array of proxy strings (format: "protocol://host:port" or "host:port")
 */
export function addScraperProxies(proxies: string[]): void {
    const scraper = getScraper();
    scraper.addProxies(proxies);
    apiLogger.info(`Added ${proxies.length} proxies to scraper`);
}

/**
 * Reset failed proxies (give them another chance)
 */
export function resetFailedProxies(): void {
    const scraper = getScraper();
    scraper.resetFailedProxies();
    apiLogger.info("Reset all failed proxies");
}

/**
 * Reset scraper statistics
 */
export function resetScraperStats(): void {
    const scraper = getScraper();
    scraper.resetStats();
    apiLogger.info("Reset scraper statistics");
}

// Legacy exports for backward compatibility
export function isScraperApiConfigured(): boolean {
    // Now always returns true since we use custom scraper
    return true;
}

export function rotateScraperSession(): number {
    // Legacy function - reset scraper stats instead
    resetScraperStats();
    return Math.floor(Math.random() * 1000000);
}
