/**
 * Auto-Settlement Service
 *
 * Periodically checks for pending parlay picks, fetches completed game
 * box scores from ESPN, and automatically settles each line individually.
 *
 * Settlement logic:
 *   - Fetches today's (and yesterday's) completed games from ESPN
 *   - For each pending pick, finds the player in the box score
 *   - Extracts the actual stat value and compares to the line
 *   - Marks pick as hit/miss/push
 *   - Once all picks in a parlay are settled, settles the parlay itself
 */

import { fetchLiveGames, fetchGameBoxScore, type LiveGame, type GameBoxScore } from "../espn-api";
import { storage } from "../storage";
import { serverLogger } from "../logger";
import type { DbParlay, DbParlayPick } from "@shared/schema";
import { logXGBoostOutcome } from "./xgboost-logger";

// Stat type mapping: our abbreviations -> ESPN box score stat labels
const STAT_LABEL_MAP: Record<string, string[]> = {
  PTS: ["PTS"],
  REB: ["REB"],
  AST: ["AST"],
  FG3M: ["3PM"],
  STL: ["STL"],
  BLK: ["BLK"],
  TO: ["TO"],
  PRA: ["PTS", "REB", "AST"],      // combo: sum
  PR: ["PTS", "REB"],               // combo: sum
  PA: ["PTS", "AST"],               // combo: sum
  RA: ["REB", "AST"],               // combo: sum
  FPTS: [],                          // fantasy score — computed below
  MIN: ["MIN"],
};

// Combo stats that require summing multiple ESPN labels
const COMBO_STATS = new Set(["PRA", "PR", "PA", "RA", "FPTS"]);

// Normalize stat abbreviations from various input formats to our canonical keys
const STAT_ALIAS: Record<string, string> = {
  "POINTS": "PTS",
  "REBOUNDS": "REB",
  "ASSISTS": "AST",
  "REBS+ASTS": "RA",
  "PTS+REBS+ASTS": "PRA",
  "PTS+REBS": "PR",
  "PTS+ASTS": "PA",
  "3-POINTERSMADE": "FG3M",
  "3-POINTERS": "FG3M",
  "3-PTMADE": "FG3M",
  "3PM": "FG3M",
  "STEALS": "STL",
  "BLOCKS": "BLK",
  "TURNOVERS": "TO",
  "FANTASYSCORE": "FPTS",
  "MINUTES": "MIN",
};

function normalizeStatKey(statAbbr: string): string {
  const upper = statAbbr.toUpperCase().replace(/\s+/g, "");
  return STAT_ALIAS[upper] || upper;
}

/**
 * Extract the actual numeric stat value for a player from their ESPN stats map.
 * Returns null if the stat can't be determined.
 */
function extractStatValue(playerStats: Record<string, string>, statAbbr: string): number | null {
  const upper = normalizeStatKey(statAbbr);
  const labels = STAT_LABEL_MAP[upper];
  if (!labels) return null;

  // Fantasy points: PTS + 1.2*REB + 1.5*AST + 3*STL + 3*BLK - 1*TO  (DraftKings style)
  if (upper === "FPTS") {
    const pts = parseStatNum(playerStats["PTS"]);
    const reb = parseStatNum(playerStats["REB"]);
    const ast = parseStatNum(playerStats["AST"]);
    const stl = parseStatNum(playerStats["STL"]);
    const blk = parseStatNum(playerStats["BLK"]);
    const to = parseStatNum(playerStats["TO"]);
    if (pts === null || reb === null || ast === null) return null;
    return pts + 1.2 * reb + 1.5 * ast + 3 * (stl ?? 0) + 3 * (blk ?? 0) - (to ?? 0);
  }

  // Combo stats: sum multiple labels
  if (COMBO_STATS.has(upper)) {
    let total = 0;
    for (const label of labels) {
      const val = parseStatNum(playerStats[label]);
      if (val === null) return null;
      total += val;
    }
    return total;
  }

  // Single stat
  const val = parseStatNum(playerStats[labels[0]]);
  return val;
}

function parseStatNum(raw: string | undefined): number | null {
  if (raw === undefined || raw === "" || raw === "--" || raw === "DNP") return null;
  // Handle minute format "32:15" -> 32
  if (raw.includes(":")) {
    const parts = raw.split(":");
    return parseInt(parts[0], 10);
  }
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

/**
 * Normalize player names for fuzzy matching.
 * ESPN might use "LeBron James" while PrizePicks uses "Lebron James".
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\-']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Determine pick result: hit, miss, or push
 */
function determineResult(actual: number, line: number, side: string): "hit" | "miss" | "push" {
  if (actual === line) return "push";
  const isOver = side.toLowerCase() === "over" || side.toLowerCase() === "more";
  if (isOver) {
    return actual > line ? "hit" : "miss";
  } else {
    return actual < line ? "hit" : "miss";
  }
}

/**
 * Build a lookup of all players from completed game box scores.
 * Key: normalized player name -> array of entries (one per game, in case of multi-date lookups)
 *
 * Stores gameDate (YYYY-MM-DD) alongside each entry so settlement can verify
 * that a pick's gameDate matches the actual game the player appeared in.
 */
interface PlayerBoxEntry {
  displayName: string;
  stats: Record<string, string>;
  teamAbbr: string;
  gameId: string;
  gameDate: string; // YYYY-MM-DD of the game
  opponentAbbr: string;
}

async function buildPlayerStatsMap(completedGames: LiveGame[]): Promise<Map<string, PlayerBoxEntry[]>> {
  const map = new Map<string, PlayerBoxEntry[]>();

  for (const game of completedGames) {
    const boxScore = await fetchGameBoxScore(game.id);
    if (!boxScore) continue;

    // Derive game date from ESPN event date (ISO string) -> YYYY-MM-DD
    const gameDate = game.date ? game.date.slice(0, 10) : "";

    const teams = [boxScore.homeTeam, boxScore.awayTeam];
    for (let i = 0; i < teams.length; i++) {
      const teamData = teams[i];
      const opponentData = teams[1 - i];
      for (const player of teamData.players) {
        const key = normalizeName(player.displayName);
        const entry: PlayerBoxEntry = {
          displayName: player.displayName,
          stats: player.stats,
          teamAbbr: teamData.abbreviation,
          gameId: game.id,
          gameDate,
          opponentAbbr: opponentData.abbreviation,
        };
        const existing = map.get(key);
        if (existing) {
          existing.push(entry);
        } else {
          map.set(key, [entry]);
        }
      }
    }
  }

  return map;
}

/**
 * Get the ESPN date string for a Date (YYYYMMDD)
 */
function toEspnDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Settle a single parlay based on its picks' results.
 * For flex plays: you can miss 1 and still win (reduced payout).
 * For power plays: all picks must hit.
 */
async function settleParlay(
  parlay: DbParlay & { picks: DbParlayPick[] }
): Promise<void> {
  const picks = parlay.picks;

  // Check if all picks are settled
  const allSettled = picks.every(p => p.result && p.result !== "pending");
  if (!allSettled) return;

  const hits = picks.filter(p => p.result === "hit").length;
  const misses = picks.filter(p => p.result === "miss").length;
  const pushes = picks.filter(p => p.result === "push").length;

  let result: "win" | "loss" | "push";
  let profit: number;

  if (parlay.parlayType === "power") {
    // Power play: all picks must hit
    if (misses > 0) {
      result = "loss";
      profit = -parlay.entryAmount;
    } else if (pushes === picks.length) {
      result = "push";
      profit = 0;
    } else {
      result = "win";
      profit = parlay.entryAmount * (parlay.payoutMultiplier - 1);
    }
  } else {
    // Flex play: can miss 1 (reduced payout)
    if (misses > 1) {
      result = "loss";
      profit = -parlay.entryAmount;
    } else if (misses === 1) {
      // Reduced payout (roughly half)
      const reducedMultiplier = Math.max(1, parlay.payoutMultiplier * 0.5);
      result = "win";
      profit = parlay.entryAmount * (reducedMultiplier - 1);
    } else if (pushes === picks.length) {
      result = "push";
      profit = 0;
    } else {
      result = "win";
      profit = parlay.entryAmount * (parlay.payoutMultiplier - 1);
    }
  }

  await storage.updateParlayResult(parlay.id, result, profit);
  serverLogger.info(
    `Auto-settled parlay #${parlay.id}: ${result} (${hits}/${picks.length} hits, profit: ${profit > 0 ? "+" : ""}${profit.toFixed(2)})`
  );
}

/**
 * Find the correct box-score entry for a pick by matching game date and team.
 *
 * Priority:
 *   1. Date + team both match → best match
 *   2. Date matches, team is empty (imported picks) → accept if only one entry for that date
 *   3. No date match → skip (prevents settling against wrong game)
 */
function findMatchingEntry(
  entries: PlayerBoxEntry[],
  pick: DbParlayPick,
): PlayerBoxEntry | null {
  // Normalize the pick's gameDate to YYYY-MM-DD for comparison
  const pickDate = pick.gameDate ? pick.gameDate.replace(/-/g, "-") : "";

  // Filter entries to those matching the pick's game date
  const dateMatches = entries.filter(e => {
    if (!pickDate || !e.gameDate) return false;
    // Compare YYYY-MM-DD strings (both should already be in this format)
    return e.gameDate === pickDate;
  });

  if (dateMatches.length === 0) {
    return null; // No completed game on the pick's date — don't settle
  }

  // If the pick has a team set, require it to match
  const pickTeam = (pick.team || "").toUpperCase().trim();
  if (pickTeam) {
    const teamMatch = dateMatches.find(
      e => e.teamAbbr.toUpperCase() === pickTeam
    );
    if (teamMatch) return teamMatch;

    // Team didn't match any entry for this date — skip rather than mis-settle
    serverLogger.debug(
      `Team mismatch for ${pick.playerName}: pick team=${pickTeam}, found teams=${dateMatches.map(e => e.teamAbbr).join(",")}`
    );
    return null;
  }

  // No team on pick (imported with team=""): accept only if there's exactly one
  // entry for this date (unambiguous). If multiple, skip to avoid wrong match.
  if (dateMatches.length === 1) {
    return dateMatches[0];
  }

  serverLogger.warn(
    `Ambiguous match for ${pick.playerName}: ${dateMatches.length} entries on ${pickDate} with no team set — skipping`
  );
  return null;
}

/**
 * Main settlement routine. Call this periodically.
 */
export async function runSettlement(): Promise<{ settledPicks: number; settledParlays: number }> {
  let settledPicks = 0;
  let settledParlays = 0;

  try {
    // 1. Get all pending parlays
    const pendingParlays = await storage.getParlays({ pending: true });
    if (pendingParlays.length === 0) {
      return { settledPicks: 0, settledParlays: 0 };
    }

    // 2. Collect unique game dates from pending picks
    const gameDates = new Set<string>();
    for (const parlay of pendingParlays) {
      for (const pick of parlay.picks) {
        if ((!pick.result || pick.result === "pending") && pick.gameDate) {
          gameDates.add(pick.gameDate);
        }
      }
    }

    if (gameDates.size === 0) {
      // No dated picks — nothing to settle
      serverLogger.debug("No game dates found on pending picks — skipping settlement");
      return { settledPicks: 0, settledParlays: 0 };
    }

    // 3. Fetch completed games for each date
    const completedGames: LiveGame[] = [];
    for (const dateStr of gameDates) {
      // Convert YYYY-MM-DD to YYYYMMDD if needed
      const espnDate = dateStr.replace(/-/g, "");
      try {
        const games = await fetchLiveGames(espnDate);
        const finished = games.filter(g => g.status.type.completed === true);
        completedGames.push(...finished);
      } catch (err) {
        serverLogger.warn(`Failed to fetch games for ${dateStr}: ${err}`);
      }
    }

    if (completedGames.length === 0) {
      serverLogger.debug("No completed games found for pending pick dates");
      return { settledPicks: 0, settledParlays: 0 };
    }

    // 4. Build player stats map from all completed box scores
    const playerMap = await buildPlayerStatsMap(completedGames);
    serverLogger.info(`Auto-settle: ${playerMap.size} players from ${completedGames.length} completed games`);

    // 5. Settle individual picks — with game-date and team alignment checks
    for (const parlay of pendingParlays) {
      let parlayChanged = false;

      for (const pick of parlay.picks) {
        if (pick.result && pick.result !== "pending") continue;

        const nameKey = normalizeName(pick.playerName);
        const entries = playerMap.get(nameKey);
        if (!entries || entries.length === 0) continue; // Player not found in any completed game

        // Find the correct box-score entry for this pick by verifying:
        //   1. Game date must match the pick's gameDate
        //   2. Team must match (if pick has a team set)
        const matchedEntry = findMatchingEntry(entries, pick);
        if (!matchedEntry) {
          serverLogger.debug(
            `Skipping pick: ${pick.playerName} — no completed game matching date=${pick.gameDate} team=${pick.team}`
          );
          continue;
        }

        const actualValue = extractStatValue(matchedEntry.stats, pick.stat);
        if (actualValue === null) continue; // Stat not available (DNP, etc.)

        const result = determineResult(actualValue, pick.line, pick.side);
        await storage.updateParlayPickResult(pick.id, result, actualValue);

        // Log outcome to XGBoost training table (fire-and-forget)
        const pickGameDate = pick.gameDate ?? toEspnDate(new Date());
        const actualMinutes = parseStatNum(matchedEntry.stats["MIN"]);
        logXGBoostOutcome(
          pick.playerName, pickGameDate, pick.stat,
          actualValue, actualMinutes ?? undefined,
        );

        // Update in-memory pick for parlay settlement check
        pick.result = result;
        pick.actualValue = actualValue;

        settledPicks++;
        parlayChanged = true;

        serverLogger.info(
          `Settled pick: ${pick.playerName} ${pick.stat} ${pick.side} ${pick.line} → actual: ${actualValue} → ${result} (game: ${matchedEntry.gameId}, date: ${matchedEntry.gameDate})`
        );
      }

      // 6. Check if all picks in this parlay are now settled
      if (parlayChanged) {
        const allSettled = parlay.picks.every(p => p.result && p.result !== "pending");
        if (allSettled) {
          await settleParlay(parlay);
          settledParlays++;
        }
      }
    }

    if (settledPicks > 0) {
      serverLogger.info(`Auto-settlement complete: ${settledPicks} picks, ${settledParlays} parlays settled`);
    }
  } catch (error) {
    serverLogger.error("Auto-settlement error:", error);
  }

  return { settledPicks, settledParlays };
}

/**
 * Auto-Settlement Manager
 * Manages the periodic settlement interval.
 * Only needs restart on server reboot.
 */
class AutoSettlementService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /**
   * Start the auto-settlement loop.
   * @param intervalMs How often to check (default: 5 minutes)
   */
  start(intervalMs = 5 * 60 * 1000) {
    if (this.intervalId) {
      serverLogger.warn("Auto-settlement already running");
      return;
    }

    serverLogger.info(`Auto-settlement service starting (interval: ${intervalMs / 1000}s)`);

    // Run once immediately on startup
    this.tick();

    // Then run on interval
    this.intervalId = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      serverLogger.info("Auto-settlement service stopped");
    }
  }

  private async tick() {
    if (this.isRunning) return; // Prevent overlapping runs
    this.isRunning = true;
    try {
      await runSettlement();
    } catch (err) {
      serverLogger.error("Auto-settle tick failed:", err);
    } finally {
      this.isRunning = false;
    }
  }
}

export const autoSettlementService = new AutoSettlementService();
