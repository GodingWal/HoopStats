/**
 * PrizePicks API client for fetching real player prop lines
 * @note This is an unofficial API - may break or get blocked
 * Uses ScraperAPI to bypass Cloudflare protection
 */

import { apiCache } from "./cache";
import { apiLogger } from "./logger";

const PRIZEPICKS_API_BASE = "https://api.prizepicks.com";
const SCRAPERAPI_BASE = "https://api.scraperapi.com";
const NBA_LEAGUE_ID = 7;

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

// Browser-like headers (used as fallback)
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Connection": "keep-alive",
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
    "Turnovers": "TOV",
    "Fantasy Score": "FPTS",
    "Pts+Rebs": "PR",
    "Pts+Asts": "PA",
    "Rebs+Asts": "RA",
    "Minutes": "MIN",
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
        const targetUrl = `${PRIZEPICKS_API_BASE}/projections?league_id=${NBA_LEAGUE_ID}&per_page=250&single_stat=true`;
        const scraperApiKey = getScraperApiKey();

        let fetchUrl: string;
        let fetchOptions: RequestInit;

        if (scraperApiKey) {
            // Use ScraperAPI to bypass Cloudflare
            fetchUrl = `${SCRAPERAPI_BASE}?api_key=${scraperApiKey}&url=${encodeURIComponent(targetUrl)}&render=false`;
            fetchOptions = { method: "GET" };
            apiLogger.info("Fetching PrizePicks via ScraperAPI proxy", { targetUrl });
        } else {
            // Direct request (may be blocked by Cloudflare)
            fetchUrl = targetUrl;
            fetchOptions = { method: "GET", headers: HEADERS };
            apiLogger.info("Fetching PrizePicks directly (no proxy configured)", { targetUrl });
        }

        const response = await fetch(fetchUrl, fetchOptions);

        if (!response.ok) {
            if (response.status === 403) {
                const errorMsg = scraperApiKey
                    ? "PrizePicks blocked even with proxy - may need premium ScraperAPI plan"
                    : "PrizePicks blocked - configure SCRAPER_API_KEY in .env to bypass Cloudflare";
                apiLogger.warn(errorMsg);
                throw new Error(errorMsg);
            }
            throw new Error(`PrizePicks API error: ${response.status} ${response.statusText}`);
        }

        const data: PrizePicksApiResponse = await response.json();

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

/**
 * Get projections for a specific player
 */
export async function fetchPlayerPrizePicksProps(playerName: string): Promise<PrizePicksProjection[]> {
    const allProjections = await fetchPrizePicksProjections();

    // Normalize the search name
    const searchName = playerName.toLowerCase().trim();
    const searchParts = searchName.split(/\s+/);

    return allProjections.filter(p => {
        const propName = p.playerName.toLowerCase().trim();

        // Exact match (case insensitive)
        if (propName === searchName) {
            return true;
        }

        // Check if all parts of search name are in the player name
        // This handles "LeBron James" matching "LeBron James" but not "James Harden"
        const propParts = propName.split(/\s+/);

        // Both names should have similar parts
        if (searchParts.length >= 2 && propParts.length >= 2) {
            // First name and last name must both match
            const firstMatch = propParts[0].includes(searchParts[0]) || searchParts[0].includes(propParts[0]);
            const lastMatch = propParts[propParts.length - 1].includes(searchParts[searchParts.length - 1]) ||
                searchParts[searchParts.length - 1].includes(propParts[propParts.length - 1]);
            return firstMatch && lastMatch;
        }

        // Single word search - must match a full word
        if (searchParts.length === 1) {
            return propParts.some(part => part === searchParts[0] || part.startsWith(searchParts[0]));
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
