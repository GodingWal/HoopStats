/**
 * Referee Assignment Scraper
 * Scrapes official.nba.com/referee-assignments/ for today's referee crews
 */

import type { Browser, Page } from 'puppeteer';
import { apiLogger } from '../logger';
import { pool } from '../db';

// Lazy load puppeteer
let puppeteer: typeof import('puppeteer') | null = null;

async function getPuppeteer() {
    if (!puppeteer) {
        try {
            puppeteer = await import('puppeteer');
        } catch (error) {
            throw new Error('Puppeteer not installed');
        }
    }
    return puppeteer;
}

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
    "Marc Davis": { fouls_pg: 38.0, tier: "MID" },
    "Zach Zarba": { fouls_pg: 37.8, tier: "MID" },
    "Josh Tiven": { fouls_pg: 37.5, tier: "MID" },
    "Ben Taylor": { fouls_pg: 37.2, tier: "MID-LOW" },
    "JB DeRosa": { fouls_pg: 37.0, tier: "MID-LOW" },
    "Derrick Collins": { fouls_pg: 36.8, tier: "MID-LOW" },
    "Eric Lewis": { fouls_pg: 36.5, tier: "LOW" },
    "Karl Lane": { fouls_pg: 36.2, tier: "LOW" },
    "Marat Kogut": { fouls_pg: 36.0, tier: "LOW" },
    "John Goble": { fouls_pg: 35.5, tier: "LOW" },
    "Tyler Ford": { fouls_pg: 35.2, tier: "LOW" },
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

/**
 * Scrape referee assignments from official.nba.com
 */
export async function scrapeRefereeAssignments(): Promise<RefAssignment[]> {
    const pptr = await getPuppeteer();
    let browser: Browser | null = null;

    try {
        apiLogger.info('[RefScraper] Launching browser...');
        browser = await pptr.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        apiLogger.info('[RefScraper] Navigating to referee assignments...');
        await page.goto('https://official.nba.com/referee-assignments/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // Wait for table to load
        await page.waitForSelector('table', { timeout: 10000 }).catch(() => null);

        // Extract assignments from table
        const assignments = await page.evaluate(() => {
            const results: RefAssignment[] = [];
            const tables = document.querySelectorAll('table');

            tables.forEach(table => {
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 4) {
                        // Parse game info (e.g., "LAL @ BOS 7:00 PM ET")
                        const gameText = cells[0]?.textContent?.trim() || '';
                        const matchup = gameText.match(/([A-Z]{3})\s*[@vs.]+\s*([A-Z]{3})/i);
                        const time = gameText.match(/\d{1,2}:\d{2}\s*(AM|PM)\s*ET/i);

                        if (matchup) {
                            results.push({
                                awayTeam: matchup[1].toUpperCase(),
                                homeTeam: matchup[2].toUpperCase(),
                                gameTime: time ? time[0] : '',
                                crewChief: cells[1]?.textContent?.trim() || '',
                                referee: cells[2]?.textContent?.trim() || '',
                                umpire: cells[3]?.textContent?.trim() || '',
                                alternate: cells[4]?.textContent?.trim() || '',
                            });
                        }
                    }
                });
            });

            return results;
        });

        apiLogger.info(`[RefScraper] Found ${assignments.length} assignments`);
        return assignments;

    } catch (error) {
        apiLogger.error('[RefScraper] Scrape failed:', { error: String(error) });
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Get today's games with referee assignments
 * Uses ESPN API for games, static REFEREE_DB for tier calculations
 * Note: Referee scraping disabled on VPS (no Puppeteer)
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

        // Map games - refs not available until we can scrape them
        return games.map(game => {
            const homeAbbr = game.competitors.find(c => c.homeAway === 'home')?.team.abbreviation || '';
            const awayAbbr = game.competitors.find(c => c.homeAway === 'away')?.team.abbreviation || '';

            return {
                gameId: game.id,
                homeTeam: homeAbbr,
                awayTeam: awayAbbr,
                gameTime: game.status.type.detail || '',
                gameDate: targetDate,
                referees: [], // Refs not available without scraper
                crewTier: undefined,
                avgFouls: undefined,
            };
        });
    } catch (error) {
        apiLogger.error('[RefScraper] Failed to get games from ESPN', { error: String(error) });
        return [];
    }
}


/**
 * Store scraped assignments in database
 */
export async function storeAssignments(assignments: RefAssignment[], gameDate: string): Promise<number> {
    let stored = 0;

    for (const assignment of assignments) {
        try {
            const refs = [assignment.crewChief, assignment.referee, assignment.umpire].filter(Boolean);

            for (const refName of refs) {
                // Upsert referee
                const [firstName, ...lastParts] = refName.split(' ');
                const lastName = lastParts.join(' ');

                await pool.query(`
                    INSERT INTO referees (id, first_name, last_name)
                    VALUES (
                        (SELECT COALESCE(MAX(id), 0) + 1 FROM referees),
                        $1, $2
                    )
                    ON CONFLICT (first_name, last_name) DO NOTHING
                `, [firstName, lastName]);

                stored++;
            }
        } catch (error) {
            apiLogger.warn('[RefScraper] Failed to store assignment', { error: String(error) });
        }
    }

    return stored;
}
