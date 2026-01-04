/**
 * The Odds API client for fetching real betting odds
 * @see https://the-odds-api.com/liveapi/guides/v4/
 */

import { apiCache } from "./cache";
import { apiLogger } from "./logger";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "basketball_nba";

// Player prop market keys
const PLAYER_PROP_MARKETS = [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_blocks",
    "player_steals",
    "player_points_rebounds_assists"
].join(",");

// Preferred US bookmakers
const BOOKMAKERS = [
    "draftkings",
    "fanduel",
    "betmgm",
    "caesars",
    "pointsbetus"
].join(",");

export interface OddsEvent {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Bookmaker[];
}

export interface Bookmaker {
    key: string;
    title: string;
    last_update: string;
    markets: Market[];
}

export interface Market {
    key: string;
    last_update: string;
    outcomes: Outcome[];
}

export interface Outcome {
    name: string;
    description?: string;
    price: number;
    point?: number;
}

export interface PlayerPropOdds {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime: string;
    props: {
        market: string;
        marketLabel: string;
        lines: {
            bookmaker: string;
            bookmakerTitle: string;
            over: { price: number; point: number } | null;
            under: { price: number; point: number } | null;
            lastUpdate: string;
        }[];
    }[];
}

const MARKET_LABELS: Record<string, string> = {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers Made",
    player_blocks: "Blocks",
    player_steals: "Steals",
    player_points_rebounds_assists: "PTS+REB+AST",
};

/**
 * Get API key from environment
 */
function getApiKey(): string | null {
    return process.env.THE_ODDS_API_KEY || null;
}

/**
 * Check if The Odds API is configured
 */
export function isOddsApiConfigured(): boolean {
    return !!getApiKey();
}

/**
 * Fetch today's NBA events/games
 */
export async function fetchNbaEvents(): Promise<OddsEvent[]> {
    const apiKey = getApiKey();
    if (!apiKey) {
        apiLogger.warn("The Odds API key not configured");
        return [];
    }

    const cacheKey = "odds-nba-events";
    const cached = apiCache.get<OddsEvent[]>(cacheKey);
    if (cached) {
        apiLogger.debug("Cache hit for NBA events");
        return cached;
    }

    try {
        const url = `${ODDS_API_BASE}/sports/${SPORT_KEY}/events?apiKey=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
        }

        const events: OddsEvent[] = await response.json();

        // Log remaining quota
        const remainingRequests = response.headers.get("x-requests-remaining");
        const usedRequests = response.headers.get("x-requests-used");
        apiLogger.info("Fetched NBA events from Odds API", {
            count: events.length,
            remaining: remainingRequests,
            used: usedRequests,
        });

        apiCache.set(cacheKey, events, 5 * 60 * 1000); // 5 min cache
        return events;
    } catch (error) {
        apiLogger.error("Failed to fetch NBA events", error);
        return [];
    }
}

/**
 * Fetch player prop odds for a specific event
 */
export async function fetchEventPlayerProps(eventId: string): Promise<PlayerPropOdds | null> {
    const apiKey = getApiKey();
    if (!apiKey) {
        apiLogger.warn("The Odds API key not configured");
        return null;
    }

    const cacheKey = `odds-props-${eventId}`;
    const cached = apiCache.get<PlayerPropOdds>(cacheKey);
    if (cached) {
        apiLogger.debug("Cache hit for event props", { eventId });
        return cached;
    }

    try {
        const url = `${ODDS_API_BASE}/sports/${SPORT_KEY}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${PLAYER_PROP_MARKETS}&oddsFormat=american&bookmakers=${BOOKMAKERS}`;
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                apiLogger.warn("Event not found or no props available", { eventId });
                return null;
            }
            throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Transform to our structure
        const result: PlayerPropOdds = {
            eventId: data.id,
            homeTeam: data.home_team,
            awayTeam: data.away_team,
            commenceTime: data.commence_time,
            props: [],
        };

        // Group markets by type across bookmakers
        const marketMap = new Map<string, PlayerPropOdds["props"][0]>();

        for (const bookmaker of data.bookmakers || []) {
            for (const market of bookmaker.markets || []) {
                if (!marketMap.has(market.key)) {
                    marketMap.set(market.key, {
                        market: market.key,
                        marketLabel: MARKET_LABELS[market.key] || market.key,
                        lines: [],
                    });
                }

                const marketEntry = marketMap.get(market.key)!;

                // Find over/under outcomes
                const overOutcome = market.outcomes?.find((o: Outcome) =>
                    o.name?.toLowerCase() === "over" || o.description?.toLowerCase()?.includes("over")
                );
                const underOutcome = market.outcomes?.find((o: Outcome) =>
                    o.name?.toLowerCase() === "under" || o.description?.toLowerCase()?.includes("under")
                );

                marketEntry.lines.push({
                    bookmaker: bookmaker.key,
                    bookmakerTitle: bookmaker.title,
                    over: overOutcome ? { price: overOutcome.price, point: overOutcome.point || 0 } : null,
                    under: underOutcome ? { price: underOutcome.price, point: underOutcome.point || 0 } : null,
                    lastUpdate: market.last_update,
                });
            }
        }

        result.props = Array.from(marketMap.values());

        // Log quota usage
        const remainingRequests = response.headers.get("x-requests-remaining");
        apiLogger.info("Fetched player props", { eventId, propsCount: result.props.length, remaining: remainingRequests });

        apiCache.set(cacheKey, result, 5 * 60 * 1000); // 5 min cache
        return result;
    } catch (error) {
        apiLogger.error("Failed to fetch event player props", error, { eventId });
        return null;
    }
}

/**
 * Fetch player props for a specific player by name (searches across today's events)
 */
export async function fetchPlayerPropsByName(playerName: string): Promise<{
    event: { id: string; homeTeam: string; awayTeam: string; commenceTime: string };
    props: PlayerPropOdds["props"];
}[]> {
    const apiKey = getApiKey();
    if (!apiKey) {
        return [];
    }

    const events = await fetchNbaEvents();
    const results: {
        event: { id: string; homeTeam: string; awayTeam: string; commenceTime: string };
        props: PlayerPropOdds["props"];
    }[] = [];

    // For now, fetch props from upcoming events
    // Note: The Odds API returns player props with player names in the outcome descriptions
    // We would need to filter by player name after fetching

    for (const event of events.slice(0, 5)) { // Limit to save API credits
        const props = await fetchEventPlayerProps(event.id);
        if (props) {
            // Filter props where player name appears in any outcome
            const playerProps = props.props.filter(p =>
                p.lines.some(l =>
                    l.over?.point !== undefined || l.under?.point !== undefined
                )
            );

            if (playerProps.length > 0) {
                results.push({
                    event: {
                        id: event.id,
                        homeTeam: props.homeTeam,
                        awayTeam: props.awayTeam,
                        commenceTime: props.commenceTime,
                    },
                    props: playerProps,
                });
            }
        }
    }

    return results;
}

/**
 * Get The Odds API usage/status info
 */
export async function getOddsApiStatus(): Promise<{
    configured: boolean;
    remainingRequests?: string;
    usedRequests?: string;
}> {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { configured: false };
    }

    try {
        // Make a cheap request to get quota info
        const url = `${ODDS_API_BASE}/sports?apiKey=${apiKey}`;
        const response = await fetch(url);

        return {
            configured: true,
            remainingRequests: response.headers.get("x-requests-remaining") || undefined,
            usedRequests: response.headers.get("x-requests-used") || undefined,
        };
    } catch {
        return { configured: true };
    }
}
