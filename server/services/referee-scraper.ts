/**
 * Referee Assignment Scraper
 * Scrapes official.nba.com/referee-assignments/ for today's referee crews
 * Uses custom scraper (not Puppeteer or ScraperAPI)
 */

import { createScraper } from '../scraper';
import { apiLogger } from '../logger';

export interface RefAssignment {
    gameId?: string;
    homeTeam: string;
    awayTeam: string;
    gameTime: string;
    crewChief: string;
    referee: string;
    umpire: string;
    alternate?: string;
}

export interface GameWithRefs {
    gameId: string;
    homeTeam: string;
    awayTeam: string;
    homeTeamId?: string;
    awayTeamId?: string;
    gameTime: string;
    gameDate: string;
    referees: string[];
    crewTier?: string;
    avgFouls?: number;
}

// Static referee data for tier calculation
const REFEREE_DB: Record<string, { fouls_pg: number; tier: string }> = {
    "Tony Brothers": { fouls_pg: 42.3, tier: "HIGH" },
    "Scott Foster": { fouls_pg: 41.8, tier: "HIGH" },
    "Kane Fitzgerald": { fouls_pg: 41.2, tier: "HIGH" },
    "James Williams": { fouls_pg: 40.8, tier: "HIGH" },
    "Ed Malloy": { fouls_pg: 40.5, tier: "HIGH" },
    "Andy Nagy": { fouls_pg: 39.9, tier: "HIGH" },
    "Curtis Blair": { fouls_pg: 40.1, tier: "HIGH" },
    "Brent Barnaky": { fouls_pg: 39.8, tier: "MID-HIGH" },
    "Bill Kennedy": { fouls_pg: 39.5, tier: "MID-HIGH" },
    "Sean Corbin": { fouls_pg: 39.2, tier: "MID-HIGH" },
    "Rodney Mott": { fouls_pg: 39.0, tier: "MID" },
    "Leon Wood": { fouls_pg: 38.7, tier: "MID" },
    "Sha'Rae Mitchell": { fouls_pg: 38.8, tier: "MID" },
    "Simone Jelks": { fouls_pg: 38.2, tier: "MID" },
    "Marc Davis": { fouls_pg: 38.0, tier: "MID" },
    "Zach Zarba": { fouls_pg: 37.8, tier: "MID" },
    "Josh Tiven": { fouls_pg: 37.5, tier: "MID" },
    "Natalie Sago": { fouls_pg: 37.6, tier: "MID" },
    "Tre Maddox": { fouls_pg: 38.5, tier: "MID" },
    "Ben Taylor": { fouls_pg: 37.2, tier: "MID-LOW" },
    "JB DeRosa": { fouls_pg: 37.0, tier: "MID-LOW" },
    "Derrick Collins": { fouls_pg: 36.8, tier: "MID-LOW" },
    "Jacyn Goble": { fouls_pg: 37.0, tier: "MID-LOW" },
    "Eric Lewis": { fouls_pg: 36.5, tier: "LOW" },
    "Karl Lane": { fouls_pg: 36.2, tier: "LOW" },
    "Marat Kogut": { fouls_pg: 36.0, tier: "LOW" },
    "Matt Boland": { fouls_pg: 35.7, tier: "LOW" },
    "John Goble": { fouls_pg: 35.5, tier: "LOW" },
    "Tyler Ford": { fouls_pg: 35.2, tier: "LOW" },
    "Kevin Scott": { fouls_pg: 38.3, tier: "MID" },
};

function calculateCrewTier(refs: string[]): { tier: string; avgFouls: number } {
    const found = refs.map(r => REFEREE_DB[r]).filter(Boolean);
    if (!found.length) return { tier: "UNKNOWN", avgFouls: 37.8 };

    const avgFouls = found.reduce((s, r) => s + r.fouls_pg, 0) / found.length;
    const avgDiff = avgFouls - 37.8;

    let tier: string;
    if (avgDiff >= 2.0) tier = "HIGH";
    else if (avgDiff >= 1.0) tier = "MID-HIGH";
    else if (avgDiff >= -0.5) tier = "MID";
    else if (avgDiff >= -1.5) tier = "MID-LOW";
    else tier = "LOW";

    return { tier, avgFouls: Math.round(avgFouls * 10) / 10 };
}

// Team name to abbreviation mapping
const TEAM_ABBR_MAP: Record<string, string> = {
    "Atlanta": "ATL", "Hawks": "ATL",
    "Boston": "BOS", "Celtics": "BOS",
    "Brooklyn": "BKN", "Nets": "BKN",
    "Charlotte": "CHA", "Hornets": "CHA",
    "Chicago": "CHI", "Bulls": "CHI",
    "Cleveland": "CLE", "Cavaliers": "CLE",
    "Dallas": "DAL", "Mavericks": "DAL",
    "Denver": "DEN", "Nuggets": "DEN",
    "Detroit": "DET", "Pistons": "DET",
    "Golden State": "GS", "Warriors": "GS",
    "Houston": "HOU", "Rockets": "HOU",
    "Indiana": "IND", "Pacers": "IND",
    "LA Clippers": "LAC", "Clippers": "LAC",
    "LA Lakers": "LAL", "Lakers": "LAL",
    "Memphis": "MEM", "Grizzlies": "MEM",
    "Miami": "MIA", "Heat": "MIA",
    "Milwaukee": "MIL", "Bucks": "MIL",
    "Minnesota": "MIN", "Timberwolves": "MIN",
    "New Orleans": "NO", "Pelicans": "NO",
    "New York": "NYK", "Knicks": "NYK",
    "Oklahoma City": "OKC", "Thunder": "OKC",
    "Orlando": "ORL", "Magic": "ORL",
    "Philadelphia": "PHI", "76ers": "PHI",
    "Phoenix": "PHX", "Suns": "PHX",
    "Portland": "POR", "Blazers": "POR", "Trail Blazers": "POR",
    "Sacramento": "SAC", "Kings": "SAC",
    "San Antonio": "SAS", "Spurs": "SAS",
    "Toronto": "TOR", "Raptors": "TOR",
    "Utah": "UTAH", "Jazz": "UTAH",
    "Washington": "WAS", "Wizards": "WAS",
};

function normalizeTeamName(name: string): string {
    // Check direct mapping
    if (TEAM_ABBR_MAP[name]) return TEAM_ABBR_MAP[name];

    // Check if already an abbreviation
    if (name.length <= 4 && name === name.toUpperCase()) return name;

    // Try to find partial match
    for (const [key, abbr] of Object.entries(TEAM_ABBR_MAP)) {
        if (name.includes(key) || key.includes(name)) return abbr;
    }

    return name;
}

/**
 * Parse referee assignments from HTML content
 */
function parseRefAssignmentsFromHtml(html: string): RefAssignment[] {
    const assignments: RefAssignment[] = [];

    // NBA.com uses a table structure for assignments
    // Pattern: date row followed by game rows with team matchups and referee names

    // Find all table rows
    const tableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

    const rows: string[][] = [];
    let match;

    while ((match = tableRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const cells: string[] = [];

        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
            // Strip HTML tags and trim
            const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
            cells.push(cellText);
        }

        if (cells.length >= 4) {
            rows.push(cells);
        }
    }

    // Parse rows - typically format: Teams | Crew Chief | Referee | Umpire
    for (const cells of rows) {
        // Skip header rows
        if (cells.some(c => c.toLowerCase().includes('crew chief') || c.toLowerCase().includes('game'))) {
            continue;
        }

        // Try to find team matchup pattern (e.g., "Lakers vs Celtics" or "LAL @ BOS")
        const teamsCell = cells[0] || '';
        const matchupPatterns = [
            /(.+?)\s*(?:vs\.?|@|at)\s*(.+)/i,
            /(.+?)\s+(?:at|@)\s+(.+)/i,
        ];

        let awayTeam = '';
        let homeTeam = '';

        for (const pattern of matchupPatterns) {
            const teamMatch = teamsCell.match(pattern);
            if (teamMatch) {
                awayTeam = normalizeTeamName(teamMatch[1].trim());
                homeTeam = normalizeTeamName(teamMatch[2].trim());
                break;
            }
        }

        if (!homeTeam || !awayTeam) continue;

        // Extract referee names from remaining cells
        const crewChief = cells[1]?.trim() || '';
        const referee = cells[2]?.trim() || '';
        const umpire = cells[3]?.trim() || '';

        // Only add if we have at least one referee name
        if (crewChief || referee || umpire) {
            assignments.push({
                homeTeam,
                awayTeam,
                gameTime: '',
                crewChief,
                referee,
                umpire,
                alternate: cells[4]?.trim(),
            });
        }
    }

    return assignments;
}

// Create scraper instance for referee assignments
const refScraper = createScraper({
    requestsPerMinute: 10,
    requestsPerSecond: 1,
    minDelayMs: 1000,
    maxDelayMs: 3000,
    maxRetries: 3,
    timeoutMs: 30000,
});

/**
 * Scrape referee assignments from official.nba.com
 */
export async function scrapeRefereeAssignments(): Promise<RefAssignment[]> {
    try {
        apiLogger.info('[RefScraper] Fetching referee assignments...');

        const response = await refScraper.get('https://official.nba.com/referee-assignments/', {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://official.nba.com/',
            },
        });

        if (!response.ok) {
            apiLogger.warn('[RefScraper] Failed to fetch assignments', { status: response.status });
            return [];
        }

        const assignments = parseRefAssignmentsFromHtml(response.body);
        apiLogger.info('[RefScraper] Parsed assignments', { count: assignments.length });

        return assignments;
    } catch (error) {
        apiLogger.error('[RefScraper] Scrape failed', { error: String(error) });
        return [];
    }
}

/**
 * Get today's games with referee assignments
 * Uses ESPN API for games, custom scraper for referee assignments
 */
export async function getTodaysGamesWithRefs(dateStr?: string): Promise<GameWithRefs[]> {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];

    try {
        // Fetch schedule from ESPN
        const { fetchLiveGames } = await import('../espn-api');
        const espnDateStr = targetDate.replace(/-/g, '');
        const games = await fetchLiveGames(espnDateStr);

        if (!games || games.length === 0) {
            apiLogger.info('[RefScraper] No games found for date', { date: targetDate });
            return [];
        }

        // Try to get referee assignments
        let assignments: RefAssignment[] = [];
        try {
            assignments = await scrapeRefereeAssignments();
            apiLogger.info('[RefScraper] Got assignments for matching', { count: assignments.length });
        } catch (error) {
            apiLogger.warn('[RefScraper] Could not fetch assignments', { error: String(error) });
        }

        // Map games with referees
        return games.map(game => {
            const homeAbbr = game.competitors.find(c => c.homeAway === 'home')?.team.abbreviation || '';
            const awayAbbr = game.competitors.find(c => c.homeAway === 'away')?.team.abbreviation || '';

            // Match assignment to game
            const assignment = assignments.find(a =>
                (a.homeTeam === homeAbbr && a.awayTeam === awayAbbr) ||
                (a.homeTeam === awayAbbr && a.awayTeam === homeAbbr) ||
                // Fuzzy match for team names
                (homeAbbr.includes(a.homeTeam) || a.homeTeam.includes(homeAbbr)) &&
                (awayAbbr.includes(a.awayTeam) || a.awayTeam.includes(awayAbbr))
            );

            const refs = assignment
                ? [assignment.crewChief, assignment.referee, assignment.umpire].filter(Boolean)
                : [];

            const { tier, avgFouls } = calculateCrewTier(refs);

            return {
                gameId: game.id,
                homeTeam: homeAbbr,
                awayTeam: awayAbbr,
                gameTime: game.status.type.detail || '',
                gameDate: targetDate,
                referees: refs,
                crewTier: refs.length > 0 ? tier : undefined,
                avgFouls: refs.length > 0 ? avgFouls : undefined,
            };
        });
    } catch (error) {
        apiLogger.error('[RefScraper] Failed to get games', { error: String(error) });
        return [];
    }
}
