import { apiCache } from "./cache";
import { apiLogger } from "./logger";
import {
  fetchLiveGames,
  fetchGameBoxScore,
  fetchTeamRoster,
  fetchAllTeams,
  getTeamIdByAbbreviation,
  getTeamAbbreviationById,
  type LiveGame,
  type ESPNAthlete,
} from "./espn-api";
import type {
  TeamStats,
  TeamBasicStats,
  TeamAdvancedStats,
  QuarterScoring,
  GameContext,
  PlayerRotationStats,
  TeamComparison,
} from "@shared/schema";

// NBA Team IDs and full info
export const NBA_TEAMS_INFO: Array<{
  id: string;
  abbr: string;
  name: string;
  fullName: string;
  conference: string;
  division: string;
}> = [
    { id: '1', abbr: 'ATL', name: 'Hawks', fullName: 'Atlanta Hawks', conference: 'Eastern', division: 'Southeast' },
    { id: '2', abbr: 'BOS', name: 'Celtics', fullName: 'Boston Celtics', conference: 'Eastern', division: 'Atlantic' },
    { id: '17', abbr: 'BKN', name: 'Nets', fullName: 'Brooklyn Nets', conference: 'Eastern', division: 'Atlantic' },
    { id: '30', abbr: 'CHA', name: 'Hornets', fullName: 'Charlotte Hornets', conference: 'Eastern', division: 'Southeast' },
    { id: '4', abbr: 'CHI', name: 'Bulls', fullName: 'Chicago Bulls', conference: 'Eastern', division: 'Central' },
    { id: '5', abbr: 'CLE', name: 'Cavaliers', fullName: 'Cleveland Cavaliers', conference: 'Eastern', division: 'Central' },
    { id: '6', abbr: 'DAL', name: 'Mavericks', fullName: 'Dallas Mavericks', conference: 'Western', division: 'Southwest' },
    { id: '7', abbr: 'DEN', name: 'Nuggets', fullName: 'Denver Nuggets', conference: 'Western', division: 'Northwest' },
    { id: '8', abbr: 'DET', name: 'Pistons', fullName: 'Detroit Pistons', conference: 'Eastern', division: 'Central' },
    { id: '9', abbr: 'GSW', name: 'Warriors', fullName: 'Golden State Warriors', conference: 'Western', division: 'Pacific' },
    { id: '10', abbr: 'HOU', name: 'Rockets', fullName: 'Houston Rockets', conference: 'Western', division: 'Southwest' },
    { id: '11', abbr: 'IND', name: 'Pacers', fullName: 'Indiana Pacers', conference: 'Eastern', division: 'Central' },
    { id: '12', abbr: 'LAC', name: 'Clippers', fullName: 'Los Angeles Clippers', conference: 'Western', division: 'Pacific' },
    { id: '13', abbr: 'LAL', name: 'Lakers', fullName: 'Los Angeles Lakers', conference: 'Western', division: 'Pacific' },
    { id: '29', abbr: 'MEM', name: 'Grizzlies', fullName: 'Memphis Grizzlies', conference: 'Western', division: 'Southwest' },
    { id: '14', abbr: 'MIA', name: 'Heat', fullName: 'Miami Heat', conference: 'Eastern', division: 'Southeast' },
    { id: '15', abbr: 'MIL', name: 'Bucks', fullName: 'Milwaukee Bucks', conference: 'Eastern', division: 'Central' },
    { id: '16', abbr: 'MIN', name: 'Timberwolves', fullName: 'Minnesota Timberwolves', conference: 'Western', division: 'Northwest' },
    { id: '3', abbr: 'NOP', name: 'Pelicans', fullName: 'New Orleans Pelicans', conference: 'Western', division: 'Southwest' },
    { id: '18', abbr: 'NYK', name: 'Knicks', fullName: 'New York Knicks', conference: 'Eastern', division: 'Atlantic' },
    { id: '25', abbr: 'OKC', name: 'Thunder', fullName: 'Oklahoma City Thunder', conference: 'Western', division: 'Northwest' },
    { id: '19', abbr: 'ORL', name: 'Magic', fullName: 'Orlando Magic', conference: 'Eastern', division: 'Southeast' },
    { id: '20', abbr: 'PHI', name: '76ers', fullName: 'Philadelphia 76ers', conference: 'Eastern', division: 'Atlantic' },
    { id: '21', abbr: 'PHX', name: 'Suns', fullName: 'Phoenix Suns', conference: 'Western', division: 'Pacific' },
    { id: '22', abbr: 'POR', name: 'Trail Blazers', fullName: 'Portland Trail Blazers', conference: 'Western', division: 'Northwest' },
    { id: '23', abbr: 'SAC', name: 'Kings', fullName: 'Sacramento Kings', conference: 'Western', division: 'Pacific' },
    { id: '24', abbr: 'SAS', name: 'Spurs', fullName: 'San Antonio Spurs', conference: 'Western', division: 'Southwest' },
    { id: '28', abbr: 'TOR', name: 'Raptors', fullName: 'Toronto Raptors', conference: 'Eastern', division: 'Atlantic' },
    { id: '26', abbr: 'UTA', name: 'Jazz', fullName: 'Utah Jazz', conference: 'Western', division: 'Northwest' },
    { id: '27', abbr: 'WAS', name: 'Wizards', fullName: 'Washington Wizards', conference: 'Eastern', division: 'Southeast' },
  ];

export function getTeamInfo(teamAbbr: string) {
  return NBA_TEAMS_INFO.find(t => t.abbr === teamAbbr.toUpperCase());
}

export function getAllTeamsInfo() {
  return NBA_TEAMS_INFO;
}

// Parse quarter scores from ESPN linescores
function parseQuarterScoring(linescores?: { value: number; period: number }[]): QuarterScoring {
  const defaultScoring: QuarterScoring = {
    q1: 0, q2: 0, q3: 0, q4: 0,
    firstHalf: 0, secondHalf: 0,
  };

  if (!linescores || linescores.length === 0) {
    return defaultScoring;
  }

  const q1 = linescores.find(l => l.period === 1)?.value || 0;
  const q2 = linescores.find(l => l.period === 2)?.value || 0;
  const q3 = linescores.find(l => l.period === 3)?.value || 0;
  const q4 = linescores.find(l => l.period === 4)?.value || 0;
  const ot = linescores.filter(l => l.period > 4).reduce((sum, l) => sum + l.value, 0);

  return {
    q1, q2, q3, q4,
    ot: ot > 0 ? ot : undefined,
    firstHalf: q1 + q2,
    secondHalf: q3 + q4,
  };
}

// Determine game type based on point differential
function getGameType(pointDiff: number, isWin: boolean): GameContext['gameType'] {
  const blowoutThreshold = 10;
  if (isWin) {
    return pointDiff >= blowoutThreshold ? 'blowout_win' : 'close_win';
  } else {
    return pointDiff <= -blowoutThreshold ? 'blowout_loss' : 'close_loss';
  }
}

// Fetch recent games for a team with quarter breakdown
export async function fetchTeamRecentGames(teamAbbr: string, numGames: number = 15): Promise<GameContext[]> {
  const cacheKey = `team-recent-games-${teamAbbr}-${numGames}`;
  const cached = apiCache.get<GameContext[]>(cacheKey);
  if (cached) return cached;

  try {
    const teamInfo = getTeamInfo(teamAbbr);
    if (!teamInfo) {
      throw new Error(`Team not found: ${teamAbbr}`);
    }

    // Fetch games from the past month
    const games: GameContext[] = [];
    const today = new Date();

    // Get games for last 30 days
    for (let i = 0; i < 30 && games.length < numGames; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

      const dayGames = await fetchLiveGames(dateStr);

      for (const game of dayGames) {
        if (!game.status.type.completed) continue;

        const teamCompetitor = game.competitors.find(
          c => c.team.abbreviation === teamAbbr
        );
        const opponentCompetitor = game.competitors.find(
          c => c.team.abbreviation !== teamAbbr
        );

        if (!teamCompetitor || !opponentCompetitor) continue;

        const teamScore = parseInt(teamCompetitor.score);
        const oppScore = parseInt(opponentCompetitor.score);
        const pointDiff = teamScore - oppScore;
        const isWin = pointDiff > 0;

        // Parse stats if available
        const getStat = (name: string) => {
          const s = teamCompetitor.statistics?.find(s => s.name === name || s.abbreviation === name);
          return s ? parseFloat(s.displayValue) : undefined;
        };

        const stats = {
          rebounds: getStat('reb') || getStat('REB'),
          assists: getStat('ast') || getStat('AST'),
          steals: getStat('stl') || getStat('STL'),
          blocks: getStat('blk') || getStat('BLK'),
          turnovers: getStat('tov') || getStat('TOV'),
          fgPct: getStat('fgPct') || getStat('FG%'),
          fg3Pct: getStat('fg3Pct') || getStat('3P%'),
          ftPct: getStat('ftPct') || getStat('FT%'),
        };

        games.push({
          gameId: game.id,
          date: game.date,
          opponent: opponentCompetitor.team.abbreviation,
          isHome: teamCompetitor.homeAway === 'home',
          result: isWin ? 'W' : 'L',
          finalScore: `${teamScore}-${oppScore}`,
          pointDifferential: pointDiff,
          gameType: getGameType(pointDiff, isWin),
          quarterScoring: parseQuarterScoring(teamCompetitor.linescores),
          stats,
        });

        if (games.length >= numGames) break;
      }
    }

    // Cache for 5 minutes
    apiCache.set(cacheKey, games, 300000);
    return games;

  } catch (error) {
    apiLogger.error(`Error fetching recent games for ${teamAbbr}`, error);
    return [];
  }
}

// Calculate team basic stats from recent games
function calculateBasicStats(games: GameContext[]): TeamBasicStats {
  if (games.length === 0) {
    return {
      gamesPlayed: 0, wins: 0, losses: 0, winPct: 0,
      ppg: 0, oppPpg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, tpg: 0,
      fgPct: 0, fg3Pct: 0, ftPct: 0,
      homeRecord: '0-0', awayRecord: '0-0',
      homePpg: 0, awayPpg: 0,
      avgQuarterScoring: { q1: 0, q2: 0, q3: 0, q4: 0, firstHalf: 0, secondHalf: 0 },
      oppAvgQuarterScoring: { q1: 0, q2: 0, q3: 0, q4: 0, firstHalf: 0, secondHalf: 0 },
    };
  }

  const wins = games.filter(g => g.result === 'W').length;
  const losses = games.filter(g => g.result === 'L').length;
  const homeGames = games.filter(g => g.isHome);
  const awayGames = games.filter(g => !g.isHome);

  // Calculate average scores
  const totalPts = games.reduce((sum, g) => {
    const [pts] = g.finalScore.split('-').map(Number);
    return sum + pts;
  }, 0);
  const totalOppPts = games.reduce((sum, g) => {
    const [, oppPts] = g.finalScore.split('-').map(Number);
    return sum + oppPts;
  }, 0);

  const homePts = homeGames.reduce((sum, g) => {
    const [pts] = g.finalScore.split('-').map(Number);
    return sum + pts;
  }, 0);
  const awayPts = awayGames.reduce((sum, g) => {
    const [pts] = g.finalScore.split('-').map(Number);
    return sum + pts;
  }, 0);

  // Average quarter scoring
  const avgQ = {
    q1: games.reduce((s, g) => s + g.quarterScoring.q1, 0) / games.length,
    q2: games.reduce((s, g) => s + g.quarterScoring.q2, 0) / games.length,
    q3: games.reduce((s, g) => s + g.quarterScoring.q3, 0) / games.length,
    q4: games.reduce((s, g) => s + g.quarterScoring.q4, 0) / games.length,
    firstHalf: games.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / games.length,
    secondHalf: games.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / games.length,
  };

  const homeWins = homeGames.filter(g => g.result === 'W').length;
  const awayWins = awayGames.filter(g => g.result === 'W').length;

  // Calculate averages from available game stats
  const avg = (key: keyof NonNullable<GameContext['stats']>) => {
    const validGames = games.filter(g => g.stats && g.stats[key] !== undefined);
    if (validGames.length === 0) return 0;
    return validGames.reduce((sum, g) => sum + (g.stats![key] || 0), 0) / validGames.length;
  };

  const rpg = avg('rebounds') || 44;
  const apg = avg('assists') || 25;
  const spg = avg('steals') || 7;
  const bpg = avg('blocks') || 5;
  const tpg = avg('turnovers') || 13;
  const rawFgPct = avg('fgPct') || 46;
  const rawFg3Pct = avg('fg3Pct') || 36;
  const rawFtPct = avg('ftPct') || 78;

  const fgPct = rawFgPct > 1 ? rawFgPct / 100 : rawFgPct;
  const fg3Pct = rawFg3Pct > 1 ? rawFg3Pct / 100 : rawFg3Pct;
  const ftPct = rawFtPct > 1 ? rawFtPct / 100 : rawFtPct;

  return {
    gamesPlayed: games.length,
    wins,
    losses,
    winPct: wins / games.length,
    ppg: totalPts / games.length,
    oppPpg: totalOppPts / games.length,
    rpg, apg, spg, bpg, tpg,
    fgPct, fg3Pct, ftPct,
    homeRecord: `${homeWins}-${homeGames.length - homeWins}`,
    awayRecord: `${awayWins}-${awayGames.length - awayWins}`,
    homePpg: homeGames.length > 0 ? homePts / homeGames.length : 0,
    awayPpg: awayGames.length > 0 ? awayPts / awayGames.length : 0,
    avgQuarterScoring: avgQ,
    oppAvgQuarterScoring: {
      q1: 27, q2: 28, q3: 27, q4: 28, firstHalf: 55, secondHalf: 55,
    },
  };
}

// Calculate player rotation stats
export async function fetchTeamRotation(teamAbbr: string, games: GameContext[]): Promise<PlayerRotationStats[]> {
  const cacheKey = `team-rotation-v2-${teamAbbr}`;
  const cached = apiCache.get<PlayerRotationStats[]>(cacheKey);
  if (cached) return cached;

  try {
    const teamInfo = getTeamInfo(teamAbbr);
    if (!teamInfo) return [];

    // Fetch full box scores for games to get minutes/rotation
    // We limit to the most recent 10 games to keep it relevant and fast
    const recentGames = games.slice(0, 10);
    const boxScorePromises = recentGames.map(g => fetchGameBoxScore(g.gameId));
    const boxScores = await Promise.all(boxScorePromises);

    const playerStatsMap = new Map<number, {
      name: string;
      position: string;
      games: number;
      starts: number;
      minutes: number;
      points: number;
      rebounds: number;
      assists: number;

      closeGames: number;
      closeMinutes: number;
      closePoints: number;

      blowoutGames: number;
      blowoutMinutes: number;
      blowoutPoints: number;
    }>();

    // Map game ID to game context for easy lookup
    const gameContextMap = new Map(recentGames.map(g => [g.gameId, g]));

    for (const box of boxScores) {
      if (!box) continue;

      const game = gameContextMap.get(box.gameId);
      if (!game) continue;

      const isClose = game.gameType.includes('close');
      const isBlowout = game.gameType.includes('blowout');

      const teamData = box.homeTeam.abbreviation === teamAbbr ? box.homeTeam : box.awayTeam;
      if (!teamData) {
        continue;
      }

      for (const player of teamData.players) {
        const playerId = parseInt(player.id);
        const stats = playerStatsMap.get(playerId) || {
          name: player.displayName,
          position: player.position,
          games: 0,
          starts: 0,
          minutes: 0,
          points: 0,
          rebounds: 0,
          assists: 0,
          closeGames: 0,
          closeMinutes: 0,
          closePoints: 0,
          blowoutGames: 0,
          blowoutMinutes: 0,
          blowoutPoints: 0,
        };

        // Parse stats
        // Parse stats
        const minStr = player.stats['MIN'] || "0";
        const minutes = parseInt(minStr) || 0;
        const pts = parseInt(player.stats['PTS'] || "0");
        const reb = parseInt(player.stats['REB'] || "0");
        const ast = parseInt(player.stats['AST'] || "0");

        if (minutes > 0) {
          stats.games++;
          stats.minutes += minutes;
          stats.points += pts;
          stats.rebounds += reb;
          stats.assists += ast;
          if (player.starter) stats.starts++;

          if (isClose) {
            stats.closeGames++;
            stats.closeMinutes += minutes;
            stats.closePoints += pts;
          } else if (isBlowout) {
            stats.blowoutGames++;
            stats.blowoutMinutes += minutes;
            stats.blowoutPoints += pts;
          }
        }

        playerStatsMap.set(playerId, stats);
      }
    }

    const rotation: PlayerRotationStats[] = [];

    for (const [playerId, stats] of playerStatsMap.entries()) {
      // Only include players with meaningful minutes (e.g. > 5 min total in last 10 games)
      if (stats.minutes < 5) continue;

      const mpg = stats.minutes / stats.games;

      rotation.push({
        playerId,
        playerName: stats.name,
        position: stats.position,
        overallMpg: Math.round(mpg * 10) / 10,
        overallPpg: Math.round((stats.points / stats.games) * 10) / 10,
        overallRpg: Math.round((stats.rebounds / stats.games) * 10) / 10,
        overallApg: Math.round((stats.assists / stats.games) * 10) / 10,
        gamesPlayed: stats.games,

        closeGameMpg: stats.closeGames > 0 ? Math.round((stats.closeMinutes / stats.closeGames) * 10) / 10 : 0,
        closeGamePpg: stats.closeGames > 0 ? Math.round((stats.closePoints / stats.closeGames) * 10) / 10 : 0,
        closeGamesPlayed: stats.closeGames,

        blowoutMpg: stats.blowoutGames > 0 ? Math.round((stats.blowoutMinutes / stats.blowoutGames) * 10) / 10 : 0,
        blowoutPpg: stats.blowoutGames > 0 ? Math.round((stats.blowoutPoints / stats.blowoutGames) * 10) / 10 : 0,
        blowoutGamesPlayed: stats.blowoutGames,

        isStarter: (stats.starts / stats.games) > 0.5,
        starterPct: Math.round((stats.starts / stats.games) * 100) / 100,
      });
    }

    // Sort by overall minutes
    rotation.sort((a, b) => b.overallMpg - a.overallMpg);

    // Cache for 30 minutes (rotation doesn't change that fast)
    apiCache.set(cacheKey, rotation, 1800000);
    return rotation;

  } catch (error) {
    apiLogger.error(`Error fetching rotation for ${teamAbbr}`, error);
    return [];
  }
}

// Calculate team advanced stats (estimated without full play-by-play data)
function calculateAdvancedStats(basicStats: TeamBasicStats): TeamAdvancedStats {
  // Estimate pace and ratings
  const pace = 100; // League average
  const possessions = pace * basicStats.gamesPlayed;

  const offRating = basicStats.ppg / pace * 100;
  const defRating = basicStats.oppPpg / pace * 100;

  return {
    offRating,
    pace,
    efgPct: basicStats.fgPct * 1.1, // Rough estimate
    tsPct: basicStats.fgPct * 1.15, // Rough estimate
    tovPct: basicStats.tpg / pace * 100,
    orbPct: 0.25, // League average
    ftRate: 0.25, // League average
    defRating,
    oppEfgPct: 0.52, // League average
    drbPct: 0.75, // Complement of opponent ORB%
    stlPct: basicStats.spg / pace * 100,
    blkPct: basicStats.bpg / pace * 100,
    netRating: offRating - defRating,
    fourFactorsOff: {
      efgPct: basicStats.fgPct * 1.1,
      tovPct: basicStats.tpg / pace * 100,
      orbPct: 0.25,
      ftRate: 0.25,
    },
    fourFactorsDef: {
      efgPct: 0.52,
      tovPct: 0.12,
      drbPct: 0.75,
      ftRate: 0.25,
    },
  };
}

// Main function to fetch complete team stats
export async function fetchTeamStats(teamAbbr: string): Promise<TeamStats | null> {
  const cacheKey = `team-stats-v2-${teamAbbr}`;
  const cached = apiCache.get<TeamStats>(cacheKey);
  if (cached) return cached;

  try {
    const teamInfo = getTeamInfo(teamAbbr);
    if (!teamInfo) {
      throw new Error(`Team not found: ${teamAbbr}`);
    }

    // Fetch recent games
    const recentGames = await fetchTeamRecentGames(teamAbbr, 15);

    // Calculate stats
    const basicStats = calculateBasicStats(recentGames);
    const advancedStats = calculateAdvancedStats(basicStats);

    // Fetch rotation
    const rotation = await fetchTeamRotation(teamAbbr, recentGames);

    // Calculate streak
    let streakType: 'W' | 'L' = recentGames[0]?.result || 'W';
    let streakCount = 0;
    for (const game of recentGames) {
      if (game.result === streakType) {
        streakCount++;
      } else {
        break;
      }
    }

    // Last 10 record
    const last10 = recentGames.slice(0, 10);
    const last10Wins = last10.filter(g => g.result === 'W').length;
    const last10Losses = last10.length - last10Wins;

    const teamStats: TeamStats = {
      teamId: parseInt(teamInfo.id),
      teamAbbr: teamInfo.abbr,
      teamName: teamInfo.fullName,
      conference: teamInfo.conference,
      division: teamInfo.division,
      basicStats,
      advancedStats,
      rotation,
      recentGames,
      streak: {
        type: streakType,
        count: streakCount,
      },
      last10: `${last10Wins}-${last10Losses}`,
    };

    // Cache for 5 minutes
    apiCache.set(cacheKey, teamStats, 300000);
    return teamStats;

  } catch (error) {
    apiLogger.error(`Error fetching team stats for ${teamAbbr}`, error);
    return null;
  }
}

// Compare two teams
export async function compareTeams(team1Abbr: string, team2Abbr: string): Promise<TeamComparison | null> {
  try {
    const [team1Stats, team2Stats] = await Promise.all([
      fetchTeamStats(team1Abbr),
      fetchTeamStats(team2Abbr),
    ]);

    if (!team1Stats || !team2Stats) {
      return null;
    }

    // Find head-to-head games
    const team1VsTeam2 = team1Stats.recentGames.filter(g => g.opponent === team2Abbr);
    const team1Wins = team1VsTeam2.filter(g => g.result === 'W').length;
    const avgPointDiff = team1VsTeam2.length > 0
      ? team1VsTeam2.reduce((sum, g) => sum + g.pointDifferential, 0) / team1VsTeam2.length
      : 0;

    return {
      team1: team1Stats,
      team2: team2Stats,
      headToHead: {
        team1Wins,
        team2Wins: team1VsTeam2.length - team1Wins,
        avgPointDiff,
        recentGames: team1VsTeam2.map(g => ({
          date: g.date,
          winner: g.result === 'W' ? team1Abbr : team2Abbr,
          score: g.finalScore,
        })),
      },
    };

  } catch (error) {
    apiLogger.error(`Error comparing teams ${team1Abbr} vs ${team2Abbr}`, error);
    return null;
  }
}
