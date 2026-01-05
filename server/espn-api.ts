
import { apiCache, shortCache } from "./cache";
import { apiLogger } from "./logger";

interface ESPNEvent {
    id: string;
    date: string;
    status: LiveGame['status'];
    competitions?: Array<{
        id: string;
        competitors: LiveGame['competitors'];
        headlines?: LiveGame['headlines'];
    }>;
}

export interface LiveGame {
    id: string;
    date: string;
    status: {
        type: {
            id: string;
            name: string;
            state: string;
            completed: boolean;
            description: string;
            detail: string;
            shortDetail: string;
        };
        period: number;
        clock: number;
        displayClock: string;
    };
    competitors: {
        id: string;
        uid: string;
        type: string;
        order: number;
        homeAway: string;
        winner?: boolean;
        team: {
            id: string;
            location: string;
            name: string;
            abbreviation: string;
            displayName: string;
            shortDisplayName: string;
            color: string;
            alternateColor: string;
            logo: string;
        };
        score: string;
        linescores?: {
            value: number;
            displayValue: string;
            period: number;
        }[];
        statistics?: Array<{
            name: string;
            abbreviation: string;
            displayValue: string;
        }>;
        leaders?: Array<{
            name: string;
            displayValue: string;
            leaders: Array<{
                displayValue: string;
                athlete: { displayName: string };
            }>;
        }>;
    }[];
    headlines?: {
        description: string;
        shortLinkText: string;
    }[];
}

// dateStr format: YYYYMMDD (e.g., "20260103")
export async function fetchLiveGames(dateStr?: string): Promise<LiveGame[]> {
    const cacheKey = `live-games-${dateStr || "today"}`;

    // Use short cache (1 min) for live game data
    const cached = shortCache.get<LiveGame[]>(cacheKey);
    if (cached) {
        apiLogger.debug("Cache hit for live games", { dateStr });
        return cached;
    }

    try {
        let url = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
        if (dateStr) {
            url += `?dates=${dateStr}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        // Safety check for expected data structure
        if (!data.events || !Array.isArray(data.events)) {
            apiLogger.warn("ESPN API returned unexpected data structure", { data });
            return [];
        }

        const games: LiveGame[] = data.events.map((event: ESPNEvent): LiveGame | null => {
            const competition = event.competitions?.[0];
            if (!competition) return null;

            return {
                id: event.id,
                date: event.date,
                status: event.status,
                competitors: competition.competitors,
                headlines: competition.headlines
            };
        }).filter((game): game is LiveGame => game !== null);

        // Cache the result
        shortCache.set(cacheKey, games);
        apiLogger.info("Fetched live games", { count: games.length, dateStr });

        return games;

    } catch (error) {
        apiLogger.error("Error fetching live games", error, { dateStr });
        return [];
    }
}

export interface GameBoxScore {
    gameId: string;
    homeTeam: {
        id: string;
        abbreviation: string;
        displayName: string;
        logo: string;
        score: string;
        players: {
            id: string;
            displayName: string;
            jersey: string;
            position: string;
            stats: { [key: string]: string };
            starter: boolean;
        }[];
    };
    awayTeam: {
        id: string;
        abbreviation: string;
        displayName: string;
        logo: string;
        score: string;
        players: {
            id: string;
            displayName: string;
            jersey: string;
            position: string;
            stats: { [key: string]: string };
            starter: boolean;
        }[];
    };
}

interface ESPNBoxScoreTeamData {
    team: {
        id: string;
        abbreviation: string;
        displayName: string;
        logo: string;
    };
    statistics?: Array<{
        labels: string[];
        athletes: Array<{
            athlete: {
                id: string;
                displayName: string;
                jersey?: string;
                position?: { abbreviation: string };
            };
            stats: string[];
            starter?: boolean;
        }>;
    }>;
}

interface ESPNCompetitor {
    homeAway: string;
    score: string;
}

export async function fetchGameBoxScore(gameId: string): Promise<GameBoxScore | null> {
    try {
        const response = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`);
        if (!response.ok) {
            throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        const boxscore = data.boxscore;
        if (!boxscore || !boxscore.teams || boxscore.teams.length < 2) {
            return null;
        }

        const parseTeamStats = (teamData: ESPNBoxScoreTeamData, isHome: boolean) => {
            const team = teamData.team;
            const players = teamData.statistics?.[0]?.athletes || [];
            const labels = teamData.statistics?.[0]?.labels || [];

            return {
                id: team.id,
                abbreviation: team.abbreviation,
                displayName: team.displayName,
                logo: team.logo,
                score: data.header?.competitions?.[0]?.competitors?.find((c: ESPNCompetitor) => c.homeAway === (isHome ? "home" : "away"))?.score || "0",
                players: players.map((p) => {
                    const statsMap: { [key: string]: string } = {};
                    labels.forEach((label: string, index: number) => {
                        if (p.stats && index < p.stats.length) {
                            statsMap[label] = p.stats[index];
                        }
                    });
                    return {
                        id: p.athlete.id,
                        displayName: p.athlete.displayName,
                        jersey: p.athlete.jersey || "",
                        position: p.athlete.position?.abbreviation || "",
                        stats: statsMap,
                        starter: p.starter || false,
                    };
                }),
            };
        };

        // ESPN returns teams in order [away, home]
        const awayTeamData = boxscore.teams[0];
        const homeTeamData = boxscore.teams[1];

        return {
            gameId,
            homeTeam: parseTeamStats(homeTeamData, true),
            awayTeam: parseTeamStats(awayTeamData, false),
        };

    } catch (error) {
        console.error("Error fetching game box score:", error);
        return null;
    }
}

export interface PlayerGameStats {
    season: string;
    stats: { [key: string]: string };
    game: {
        id: string;
        date: string;
        opponent: {
            id: string;
            displayName: string;
            abbreviation: string;
            logo: string;
        };
        result: string;
        score: string;
        isHome: boolean;
    };
}

export async function fetchPlayerGamelog(playerId: string): Promise<PlayerGameStats[]> {
    try {
        const response = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`);
        if (!response.ok) {
            throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        // Safety checks
        if (!data.labels || !data.seasonTypes || !data.events) {
            console.warn("ESPN API returned unexpected data structure for gamelog:", data);
            return [];
        }

        const labels = data.labels; // e.g., ["MIN", "FG", "FG%", ...]
        const gameLogEntries: PlayerGameStats[] = [];

        // Traverse seasonTypes -> categories -> events
        for (const seasonType of data.seasonTypes) {
            if (seasonType.categories) {
                for (const category of seasonType.categories) {
                    if (category.events) {
                        for (const eventEntry of category.events) {
                            const eventId = eventEntry.eventId;
                            const statsValues = eventEntry.stats;
                            const gameInfo = data.events[eventId];

                            if (gameInfo && statsValues) {
                                // Map stats array to object using labels
                                const statsMap: { [key: string]: string } = {};
                                labels.forEach((label: string, index: number) => {
                                    if (index < statsValues.length) {
                                        statsMap[label] = statsValues[index];
                                    }
                                });

                                // Parse game info
                                // Determine opponent. The endpoint usually provides an 'opponent' object directly in the event
                                const opponent = gameInfo.opponent;

                                gameLogEntries.push({
                                    season: seasonType.displayName, // e.g. "2025-26 Regular Season"
                                    stats: statsMap,
                                    game: {
                                        id: eventId,
                                        date: gameInfo.gameDate,
                                        opponent: {
                                            id: opponent?.id,
                                            displayName: opponent?.displayName,
                                            abbreviation: opponent?.abbreviation,
                                            logo: opponent?.logo,
                                        },
                                        result: gameInfo.gameResult,
                                        score: gameInfo.score,
                                        isHome: gameInfo.atVs === 'vs', // 'vs' means home, '@' means away
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }

        return gameLogEntries;

    } catch (error) {
        console.error("Error fetching player gamelog:", error);
        return [];
    }
}

export interface ESPNTeam {
    id: string;
    uid: string;
    slug: string;
    abbreviation: string;
    displayName: string;
    shortDisplayName: string;
    name: string;
    nickname: string;
    location: string;
    color: string;
    alternateColor: string;
    isActive: boolean;
    logos: { href: string; rel: string[] }[];
}

export async function fetchAllTeams(): Promise<ESPNTeam[]> {
    try {
        // limit=100 to get all teams
        const response = await fetch("https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100");
        if (!response.ok) {
            throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.sports?.[0]?.leagues?.[0]?.teams?.map((t: any) => t.team) || [];
    } catch (error) {
        console.error("Error fetching all teams:", error);
        return [];
    }
}

export interface ESPNAthlete {
    id: string;
    uid: string;
    firstName: string;
    lastName: string;
    fullName: string;
    displayName: string;
    shortName: string;
    weight: number;
    displayWeight: string;
    height: number;
    displayHeight: string;
    age: number;
    dateOfBirth: string;
    jersey: string;
    position: {
        id: string;
        name: string;
        displayName: string;
        abbreviation: string;
    };
    headshot?: {
        href: string;
        alt: string;
    };
    injuries: Array<{
        id?: string;
        status?: string;
        date?: string;
        description?: string;
        type?: string;
        longComment?: string;
        shortComment?: string;
    }>;
    status: {
        id: string;
        name: string;
        type: string;
        abbreviation: string;
    };
}

export async function fetchTeamRoster(teamId: string): Promise<ESPNAthlete[]> {
    try {
        const response = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`);
        if (!response.ok) {
            throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.athletes || [];
    } catch (error) {
        console.error(`Error fetching roster for team ${teamId}:`, error);
        return [];
    }
}

export interface ESPNPlayerCommon {
    athlete: {
        id: string;
        firstName: string;
        lastName: string;
        displayName: string;
        jersey?: string;
    };
    position: {
        id: string;
        name: string;
        abbreviation: string;
    };
    team: {
        id: string;
        abbreviation: string;
        displayName: string;
    };
}

export async function fetchPlayerCommon(playerId: string): Promise<ESPNPlayerCommon | null> {
    try {
        const response = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}`);
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        return data; // Return the whole object as it matches the structure roughly or access fields as needed
    } catch (error) {
        console.error(`Error fetching common player data for ${playerId}:`, error);
        return null;
    }
}
