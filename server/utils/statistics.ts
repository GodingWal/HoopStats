/**
 * Statistical utility functions for bet analysis
 *
 * Provides sample-size-aware confidence calculations using
 * Wilson score intervals and related methods.
 */

/**
 * Wilson score lower bound - gives a conservative estimate of the true
 * proportion given a sample. With small samples, this regresses toward 50%.
 *
 * Example: 3/3 hits (100%) → ~43.8% lower bound
 *          70/100 hits (70%) → ~60.5% lower bound
 *          350/500 hits (70%) → ~66.0% lower bound
 *
 * @param successes Number of successes (e.g., games over the line)
 * @param total Total number of trials (e.g., total games)
 * @param z Z-score for confidence level (default 1.96 for 95% CI)
 * @returns Lower bound of the confidence interval (0-1)
 */
export function wilsonLowerBound(successes: number, total: number, z: number = 1.96): number {
  if (total === 0) return 0;

  const phat = successes / total;
  const denominator = 1 + z * z / total;
  const centre = phat + z * z / (2 * total);
  const spread = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total);

  return (centre - spread) / denominator;
}

/**
 * Wilson score upper bound - used for UNDER bets where low hit rate is good.
 *
 * @param successes Number of successes
 * @param total Total trials
 * @param z Z-score (default 1.96)
 * @returns Upper bound of the confidence interval (0-1)
 */
export function wilsonUpperBound(successes: number, total: number, z: number = 1.96): number {
  if (total === 0) return 1;

  const phat = successes / total;
  const denominator = 1 + z * z / total;
  const centre = phat + z * z / (2 * total);
  const spread = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total);

  return (centre + spread) / denominator;
}

/**
 * Get sample-size-adjusted hit rate for confidence thresholding.
 * For OVER bets, uses Wilson lower bound (conservative).
 * For UNDER bets, uses Wilson upper bound (conservative).
 *
 * @param hitRate Raw hit rate as percentage (0-100)
 * @param sampleSize Number of games
 * @param recommendation OVER or UNDER
 * @returns Adjusted hit rate as percentage (0-100)
 */
export function adjustedHitRate(
  hitRate: number,
  sampleSize: number,
  recommendation: 'OVER' | 'UNDER'
): number {
  const successes = Math.round((hitRate / 100) * sampleSize);

  if (recommendation === 'OVER') {
    return wilsonLowerBound(successes, sampleSize) * 100;
  } else {
    return wilsonUpperBound(successes, sampleSize) * 100;
  }
}

/**
 * Calculate real hit rates from game logs for a specific stat type and set of lines.
 *
 * @param gameLogs Array of game log entries
 * @param statType Stat key (PTS, REB, AST, FG3M, PRA)
 * @param seasonAvg Season average for this stat (used to generate lines)
 * @returns Map of line → { rate, sampleSize }
 */
export function calculateHitRatesFromGameLogs(
  gameLogs: Array<Record<string, any>>,
  statType: string,
  seasonAvg: number
): Record<string, { rate: number; sampleSize: number }> {
  const rates: Record<string, { rate: number; sampleSize: number }> = {};

  if (!gameLogs || gameLogs.length === 0) return rates;

  // Generate lines at 0.5 intervals around the average (avg-5 to avg+5)
  const lines: number[] = [];
  const start = Math.max(0.5, Math.floor(seasonAvg - 5) + 0.5);
  const end = Math.floor(seasonAvg + 5) + 0.5;
  for (let line = start; line <= end; line += 1) {
    lines.push(line);
  }

  // Get actual stat values from game logs
  const values: number[] = [];
  for (const game of gameLogs) {
    let val: number | undefined;
    if (statType === 'PRA') {
      const pts = typeof game.PTS === 'number' ? game.PTS : 0;
      const reb = typeof game.REB === 'number' ? game.REB : 0;
      const ast = typeof game.AST === 'number' ? game.AST : 0;
      val = pts + reb + ast;
    } else {
      val = game[statType];
    }
    if (typeof val === 'number') {
      values.push(val);
    }
  }

  if (values.length < 10) return rates; // Require minimum 10 games

  // Calculate hit rate for each line
  for (const line of lines) {
    const overs = values.filter(v => v > line).length;
    const total = values.length;
    const rate = (overs / total) * 100;

    rates[line.toString()] = {
      rate: Math.round(rate * 10) / 10,
      sampleSize: total,
    };
  }

  return rates;
}

/**
 * Calculate home and away averages from game logs.
 *
 * @param gameLogs Array of game log entries with isHome indicator
 * @returns { home, away } split averages or null if insufficient data
 */
export function calculateHomAwaySplits(
  gameLogs: Array<Record<string, any>>
): { home: { PTS: number; REB: number; AST: number; PRA: number }; away: { PTS: number; REB: number; AST: number; PRA: number } } | null {
  const homeGames = gameLogs.filter(g => g.IS_HOME === true);
  const awayGames = gameLogs.filter(g => g.IS_HOME === false);

  // Require minimum 8 games per split
  if (homeGames.length < 8 || awayGames.length < 8) return null;

  const statKeys = ['PTS', 'REB', 'AST', 'FG3M', 'PRA'];

  const avg = (games: Array<Record<string, any>>, key: string): number => {
    const vals = games.map(g => {
      if (key === 'PRA') {
        return (g.PTS || 0) + (g.REB || 0) + (g.AST || 0);
      }
      return g[key];
    }).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return 0;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const homeAvg = (key: string) => avg(homeGames, key);
  const awayAvg = (key: string) => avg(awayGames, key);

  return {
    home: { PTS: homeAvg('PTS'), REB: homeAvg('REB'), AST: homeAvg('AST'), PRA: homeAvg('PRA') },
    away: { PTS: awayAvg('PTS'), REB: awayAvg('REB'), AST: awayAvg('AST'), PRA: awayAvg('PRA') },
  };
}
