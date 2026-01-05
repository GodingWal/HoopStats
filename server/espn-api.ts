
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

// ========================================
// INJURY DATA FETCHING
// ========================================

export interface PlayerInjuryReport {
    playerId: number;
    playerName: string;
    team: string;
    teamId: number;
    status: 'out' | 'doubtful' | 'questionable' | 'probable' | 'available' | 'day-to-day' | 'suspended';
    injuryType?: string;
    description?: string;
    returnDate?: string;
    source: 'espn';
}

interface ESPNInjuryData {
    id?: string;
    status?: string;
    date?: string;
    description?: string;
    type?: { id: string; name: string; abbreviation: string };
    longComment?: string;
    shortComment?: string;
}

// Map ESPN status to our standardized status
function mapEspnStatus(status: string | undefined, injuryData?: ESPNInjuryData): PlayerInjuryReport['status'] {
    if (!status) return 'available';

    const statusLower = status.toLowerCase();

    // Check athlete status first
    if (statusLower === 'active' && !injuryData) return 'available';

    // Check injury data if present
    if (injuryData) {
        const injuryStatus = injuryData.status?.toLowerCase() || '';
        if (injuryStatus.includes('out')) return 'out';
        if (injuryStatus.includes('doubtful')) return 'doubtful';
        if (injuryStatus.includes('questionable')) return 'questionable';
        if (injuryStatus.includes('probable')) return 'probable';
        if (injuryStatus.includes('day-to-day') || injuryStatus.includes('day to day')) return 'day-to-day';
    }

    // Check the athlete status.type
    if (statusLower.includes('out')) return 'out';
    if (statusLower.includes('injured')) return 'out';
    if (statusLower.includes('doubtful')) return 'doubtful';
    if (statusLower.includes('questionable')) return 'questionable';
    if (statusLower.includes('probable')) return 'probable';
    if (statusLower.includes('day-to-day') || statusLower.includes('day to day')) return 'day-to-day';
    if (statusLower.includes('suspended')) return 'suspended';
    if (statusLower === 'active') return 'available';

    return 'available';
}

// Fetch injury report for a specific team
export async function fetchTeamInjuries(teamId: string): Promise<PlayerInjuryReport[]> {
    const cacheKey = `team-injuries-${teamId}`;
    const cached = apiCache.get<PlayerInjuryReport[]>(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const roster = await fetchTeamRoster(teamId);
        const injuries: PlayerInjuryReport[] = [];

        for (const athlete of roster) {
            // Check if player has any injuries or non-active status
            const hasInjury = athlete.injuries && athlete.injuries.length > 0;
            const isNotActive = athlete.status?.name?.toLowerCase() !== 'active';

            if (hasInjury || isNotActive) {
                const latestInjury = athlete.injuries?.[0];
                const status = mapEspnStatus(athlete.status?.name, latestInjury);

                // Only include players who are not 'available'
                if (status !== 'available') {
                    injuries.push({
                        playerId: parseInt(athlete.id),
                        playerName: athlete.displayName || `${athlete.firstName} ${athlete.lastName}`,
                        team: '', // Will be filled from team data
                        teamId: parseInt(teamId),
                        status,
                        injuryType: latestInjury?.type?.name || latestInjury?.shortComment?.split(' - ')?.[0],
                        description: latestInjury?.longComment || latestInjury?.shortComment || latestInjury?.description,
                        returnDate: latestInjury?.date,
                        source: 'espn',
                    });
                }
            }
        }

        // Cache for 2 minutes (injury data can change quickly)
        apiCache.set(cacheKey, injuries, 120000);
        return injuries;

    } catch (error) {
        apiLogger.error(`Error fetching team injuries for team ${teamId}`, error);
        return [];
    }
}

// NBA team IDs for ESPN
const NBA_TEAM_IDS = [
    { id: '1', abbr: 'ATL', name: 'Hawks' },
    { id: '2', abbr: 'BOS', name: 'Celtics' },
    { id: '17', abbr: 'BKN', name: 'Nets' },
    { id: '30', abbr: 'CHA', name: 'Hornets' },
    { id: '4', abbr: 'CHI', name: 'Bulls' },
    { id: '5', abbr: 'CLE', name: 'Cavaliers' },
    { id: '6', abbr: 'DAL', name: 'Mavericks' },
    { id: '7', abbr: 'DEN', name: 'Nuggets' },
    { id: '8', abbr: 'DET', name: 'Pistons' },
    { id: '9', abbr: 'GSW', name: 'Warriors' },
    { id: '10', abbr: 'HOU', name: 'Rockets' },
    { id: '11', abbr: 'IND', name: 'Pacers' },
    { id: '12', abbr: 'LAC', name: 'Clippers' },
    { id: '13', abbr: 'LAL', name: 'Lakers' },
    { id: '29', abbr: 'MEM', name: 'Grizzlies' },
    { id: '14', abbr: 'MIA', name: 'Heat' },
    { id: '15', abbr: 'MIL', name: 'Bucks' },
    { id: '16', abbr: 'MIN', name: 'Timberwolves' },
    { id: '3', abbr: 'NOP', name: 'Pelicans' },
    { id: '18', abbr: 'NYK', name: 'Knicks' },
    { id: '25', abbr: 'OKC', name: 'Thunder' },
    { id: '19', abbr: 'ORL', name: 'Magic' },
    { id: '20', abbr: 'PHI', name: '76ers' },
    { id: '21', abbr: 'PHX', name: 'Suns' },
    { id: '22', abbr: 'POR', name: 'Trail Blazers' },
    { id: '23', abbr: 'SAC', name: 'Kings' },
    { id: '24', abbr: 'SAS', name: 'Spurs' },
    { id: '28', abbr: 'TOR', name: 'Raptors' },
    { id: '26', abbr: 'UTA', name: 'Jazz' },
    { id: '27', abbr: 'WAS', name: 'Wizards' },
];

export function getTeamAbbreviationById(teamId: number): string {
    const team = NBA_TEAM_IDS.find(t => parseInt(t.id) === teamId);
    return team?.abbr || 'UNK';
}

export function getTeamIdByAbbreviation(abbr: string): number | null {
    const team = NBA_TEAM_IDS.find(t => t.abbr === abbr);
    return team ? parseInt(team.id) : null;
}

// Fetch all NBA injuries (league-wide)
export async function fetchAllNbaInjuries(): Promise<PlayerInjuryReport[]> {
    const cacheKey = 'all-nba-injuries';
    const cached = apiCache.get<PlayerInjuryReport[]>(cacheKey);
    if (cached) {
        apiLogger.debug("Cache hit for all NBA injuries");
        return cached;
    }

    apiLogger.info("Fetching injury reports for all NBA teams...");

    const allInjuries: PlayerInjuryReport[] = [];

    // Fetch injuries for all teams in parallel (batched to avoid rate limiting)
    const batchSize = 10;
    for (let i = 0; i < NBA_TEAM_IDS.length; i += batchSize) {
        const batch = NBA_TEAM_IDS.slice(i, i + batchSize);
        const batchPromises = batch.map(team =>
            fetchTeamInjuries(team.id).then(injuries =>
                injuries.map(inj => ({ ...inj, team: team.abbr }))
            )
        );

        const batchResults = await Promise.all(batchPromises);
        for (const teamInjuries of batchResults) {
            allInjuries.push(...teamInjuries);
        }
    }

    // Cache for 2 minutes
    apiCache.set(cacheKey, allInjuries, 120000);
    apiLogger.info(`Fetched ${allInjuries.length} injury reports across all teams`);

    return allInjuries;
}

// Fetch injuries for teams playing today (more focused approach)
export async function fetchTodaysGameInjuries(): Promise<PlayerInjuryReport[]> {
    const cacheKey = 'todays-game-injuries';
    const cached = apiCache.get<PlayerInjuryReport[]>(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        // Get today's games
        const todaysGames = await fetchLiveGames();
        const teamIds = new Set<string>();

        // Extract all team IDs from today's games
        for (const game of todaysGames) {
            for (const competitor of game.competitors) {
                teamIds.add(competitor.team.id);
            }
        }

        if (teamIds.size === 0) {
            return [];
        }

        apiLogger.info(`Fetching injuries for ${teamIds.size} teams with games today`);

        // Fetch injuries for these teams
        const allInjuries: PlayerInjuryReport[] = [];
        const promises = Array.from(teamIds).map(teamId =>
            fetchTeamInjuries(teamId).then(injuries => {
                const abbr = getTeamAbbreviationById(parseInt(teamId));
                return injuries.map(inj => ({ ...inj, team: abbr }));
            })
        );

        const results = await Promise.all(promises);
        for (const teamInjuries of results) {
            allInjuries.push(...teamInjuries);
        }

        // Cache for 2 minutes
        apiCache.set(cacheKey, allInjuries, 120000);
        apiLogger.info(`Found ${allInjuries.length} injuries for teams playing today`);

        return allInjuries;

    } catch (error) {
        apiLogger.error("Error fetching today's game injuries", error);
        return [];
    }
}

// Get players who are OUT for a specific team (for projection adjustments)
export async function getTeamOutPlayers(teamAbbr: string): Promise<string[]> {
    const teamId = getTeamIdByAbbreviation(teamAbbr);
    if (!teamId) {
        return [];
    }

    const injuries = await fetchTeamInjuries(teamId.toString());
    return injuries
        .filter(inj => inj.status === 'out')
        .map(inj => inj.playerName);
}
