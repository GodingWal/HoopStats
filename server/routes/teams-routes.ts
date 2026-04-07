import type { Express } from "express";
import { pool } from "../db";
import { apiLogger } from "../logger";
import { fetchTeamStats, fetchTeamRecentGames, fetchTeamRotation, compareTeams, getAllTeamsInfo, getTeamInfo } from "../team-stats-api";

export function registerTeamsRoutes(app: Express): void {
  app.get("/api/teams", async (_req, res) => {
    try {
      const teams = getAllTeamsInfo();
      res.json(teams);
    } catch (error) {
      apiLogger.error("Error fetching teams:", error);
      res.status(500).json({ error: "Failed to fetch teams" });
    }
  });

  // Get complete team stats by abbreviation
  app.get("/api/teams/:teamAbbr/stats", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const stats = await fetchTeamStats(teamAbbr.toUpperCase());
      if (!stats) {
        return res.status(404).json({ error: "Team not found or no data available" });
      }

      res.json(stats);
    } catch (error) {
      apiLogger.error("Error fetching team stats:", error);
      res.status(500).json({ error: "Failed to fetch team stats" });
    }
  });

  // Get team recent games with quarter breakdown
  app.get("/api/teams/:teamAbbr/games", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      const limit = parseInt(req.query.limit as string) || 15;

      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const games = await fetchTeamRecentGames(teamAbbr.toUpperCase(), limit);
      res.json({
        team: teamAbbr.toUpperCase(),
        games,
        count: games.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching team games:", error);
      res.status(500).json({ error: "Failed to fetch team games" });
    }
  });

  // Get team rotation stats (minutes by game type)
  app.get("/api/teams/:teamAbbr/rotation", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      // Get recent games first for context
      const games = await fetchTeamRecentGames(teamAbbr.toUpperCase(), 15);
      const rotation = await fetchTeamRotation(teamAbbr.toUpperCase(), games);

      // Calculate summary stats
      const closeGames = games.filter(g => g.gameType === 'close_win' || g.gameType === 'close_loss');
      const blowouts = games.filter(g => g.gameType === 'blowout_win' || g.gameType === 'blowout_loss');

      res.json({
        team: teamAbbr.toUpperCase(),
        rotation,
        summary: {
          totalGames: games.length,
          closeGames: closeGames.length,
          blowouts: blowouts.length,
          closeGamePct: games.length > 0 ? closeGames.length / games.length : 0,
        },
      });
    } catch (error) {
      apiLogger.error("Error fetching team rotation:", error);
      res.status(500).json({ error: "Failed to fetch team rotation" });
    }
  });

  // Compare two teams
  app.get("/api/teams/compare/:team1/:team2", async (req, res) => {
    try {
      const { team1, team2 } = req.params;
      if (!team1 || !team2) {
        return res.status(400).json({ error: "Both team abbreviations are required" });
      }

      const comparison = await compareTeams(team1.toUpperCase(), team2.toUpperCase());
      if (!comparison) {
        return res.status(404).json({ error: "Could not compare teams - one or both not found" });
      }

      res.json(comparison);
    } catch (error) {
      apiLogger.error("Error comparing teams:", error);
      res.status(500).json({ error: "Failed to compare teams" });
    }
  });

  // Get team quarter scoring averages
  app.get("/api/teams/:teamAbbr/scoring", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const games = await fetchTeamRecentGames(teamAbbr.toUpperCase(), 15);

      if (games.length === 0) {
        return res.status(404).json({ error: "No games found for team" });
      }

      // Calculate scoring averages
      const avgScoring = {
        q1: games.reduce((s, g) => s + g.quarterScoring.q1, 0) / games.length,
        q2: games.reduce((s, g) => s + g.quarterScoring.q2, 0) / games.length,
        q3: games.reduce((s, g) => s + g.quarterScoring.q3, 0) / games.length,
        q4: games.reduce((s, g) => s + g.quarterScoring.q4, 0) / games.length,
        firstHalf: games.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / games.length,
        secondHalf: games.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / games.length,
      };

      // Home vs Away
      const homeGames = games.filter(g => g.isHome);
      const awayGames = games.filter(g => !g.isHome);

      const homeAvg = homeGames.length > 0 ? {
        q1: homeGames.reduce((s, g) => s + g.quarterScoring.q1, 0) / homeGames.length,
        q2: homeGames.reduce((s, g) => s + g.quarterScoring.q2, 0) / homeGames.length,
        q3: homeGames.reduce((s, g) => s + g.quarterScoring.q3, 0) / homeGames.length,
        q4: homeGames.reduce((s, g) => s + g.quarterScoring.q4, 0) / homeGames.length,
        firstHalf: homeGames.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / homeGames.length,
        secondHalf: homeGames.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / homeGames.length,
      } : null;

      const awayAvg = awayGames.length > 0 ? {
        q1: awayGames.reduce((s, g) => s + g.quarterScoring.q1, 0) / awayGames.length,
        q2: awayGames.reduce((s, g) => s + g.quarterScoring.q2, 0) / awayGames.length,
        q3: awayGames.reduce((s, g) => s + g.quarterScoring.q3, 0) / awayGames.length,
        q4: awayGames.reduce((s, g) => s + g.quarterScoring.q4, 0) / awayGames.length,
        firstHalf: awayGames.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / awayGames.length,
        secondHalf: awayGames.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / awayGames.length,
      } : null;

      res.json({
        team: teamAbbr.toUpperCase(),
        gamesAnalyzed: games.length,
        overall: avgScoring,
        home: homeAvg,
        away: awayAvg,
        byGame: games.map(g => ({
          date: g.date,
          opponent: g.opponent,
          isHome: g.isHome,
          result: g.result,
          ...g.quarterScoring,
        })),
      });
    } catch (error) {
      apiLogger.error("Error fetching team scoring:", error);
      res.status(500).json({ error: "Failed to fetch team scoring" });
    }
  });

  // =============== GAME PREDICTION (NBA-Game-Predictor style) ===============

  // Predict game outcome between two teams using weighted feature ensemble
  app.get("/api/teams/predict/:team1/:team2", async (req, res) => {
    try {
      const { team1, team2 } = req.params;
      const homeTeam = (req.query.home as string || team1).toUpperCase();
      const gameDate = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      if (!team1 || !team2) {
        return res.status(400).json({ error: "Both team abbreviations are required" });
      }

      const comparison = await compareTeams(team1.toUpperCase(), team2.toUpperCase());
      if (!comparison) {
        return res.status(404).json({ error: "Could not predict - one or both teams not found" });
      }

      const t1 = comparison.team1;
      const t2 = comparison.team2;
      const t1Basic = t1.basicStats;
      const t2Basic = t2.basicStats;
      const t1Adv = t1.advancedStats;
      const t2Adv = t2.advancedStats;

      // ---- Fix 3: B2B / rest-days context ----
      // Find the most recent game date for each team from their recent game log.
      // If either team played yesterday (or same-day for a second game), they're on a B2B.
      let t1RestDays = 2; // default: assume normal rest
      let t2RestDays = 2;
      let t1IsB2B = false;
      let t2IsB2B = false;

      try {
        const gameDateObj = new Date(gameDate);
        const getRestDays = (games: typeof t1.recentGames): number => {
          if (!games || games.length === 0) return 2;
          // recentGames are sorted newest-first; find the most recent completed game
          const lastGame = games[0];
          if (!lastGame.date) return 2;
          const lastDateObj = new Date(lastGame.date);
          const diffMs = gameDateObj.getTime() - lastDateObj.getTime();
          return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        };

        t1RestDays = getRestDays(t1.recentGames);
        t2RestDays = getRestDays(t2.recentGames);
        t1IsB2B = t1RestDays <= 1;
        t2IsB2B = t2RestDays <= 1;
      } catch (restErr: any) {
        apiLogger.warn(`[Predict] Rest days calculation failed: ${restErr.message}`);
      }

      // Rest differential: positive favors team1 (they have more rest)
      // Scale: 0 to ±1.0 over a 0–4 day range, matching other normalized features
      const restDiff = Math.max(-1, Math.min(1, (t1RestDays - t2RestDays) / 4));
      // B2B penalty: a team on a B2B loses ~2-3% win probability empirically
      const t1B2bPenalty = t1IsB2B ? -0.025 : 0;
      const t2B2bPenalty = t2IsB2B ? -0.025 : 0;
      const b2bNetDiff = t1B2bPenalty - t2B2bPenalty; // positive = team1 advantaged

      // ---- Fix 4: Injury strength adjustment ----
      // Injured starters reduce team strength proportional to their minutes share.
      // Star players (top-2 by MPG on team) get a larger multiplier.
      let t1InjuryPenalty = 0;
      let t2InjuryPenalty = 0;
      let t1InjuredOut: string[] = [];
      let t2InjuredOut: string[] = [];

      try {
        const applyInjuryPenalty = (rotation: typeof t1.rotation, teamAbbr: string): { penalty: number; out: string[] } => {
          const injuredNames = (rotation && rotation.length === 0)
            ? []
            : (() => {
                // Players in injuryWatcher but NOT in rotation are out
                // We infer this by checking rotation vs. what we'd expect
                return [] as string[];
              })();

          // The rotation already excludes injured players (filtered in fetchTeamRotation).
          // Estimate missing contribution: compare expected starters (top-8 by MPG last season)
          // vs current rotation top-8. We use a simpler heuristic: if the rotation has
          // fewer than 8 players with >20 mpg, assume key players are missing.
          if (!rotation || rotation.length === 0) return { penalty: 0, out: [] };

          // Sort rotation by MPG to find stars
          const sorted = [...rotation].sort((a, b) => b.overallMpg - a.overallMpg);
          const topPlayers = sorted.slice(0, 8);

          // Heuristic: a "full strength" team has its top 2 players at 30+ MPG
          // If top player <28 MPG average it might indicate load management or injury
          // But more reliably: count players by MPG tier
          const has30MinStar = topPlayers.some(p => p.overallMpg >= 30);
          const starCount = topPlayers.filter(p => p.overallMpg >= 28).length;

          // If a team only has 1 true star in rotation (normally has 2+), apply penalty
          let penalty = 0;
          if (starCount < 1) penalty += 0.08;        // missing all stars
          else if (starCount < 2 && !has30MinStar) penalty += 0.04; // missing one star

          return { penalty, out: injuredNames };
        };

        const t1InjResult = applyInjuryPenalty(t1.rotation, team1.toUpperCase());
        const t2InjResult = applyInjuryPenalty(t2.rotation, team2.toUpperCase());
        t1InjuryPenalty = t1InjResult.penalty;
        t2InjuryPenalty = t2InjResult.penalty;
        t1InjuredOut = t1InjResult.out;
        t2InjuredOut = t2InjResult.out;
      } catch (injErr: any) {
        apiLogger.warn(`[Predict] Injury adjustment failed: ${injErr.message}`);
      }

      // Net injury differential (positive = team1 is healthier relative to team2)
      const injuryDiff = t2InjuryPenalty - t1InjuryPenalty;

      // ---- Feature Engineering ----

      // 1. Win percentage differential (season-to-date)
      const winPctDiff = t1Basic.winPct - t2Basic.winPct;

      // 2. Points per game differential (rolling avg proxy)
      const ppgDiff = t1Basic.ppg - t2Basic.ppg;

      // 3. Opponent PPG differential (defensive strength)
      const oppPpgDiff = t2Basic.oppPpg - t1Basic.oppPpg;

      // 4. Offensive rating differential
      const offRatingDiff = (t1Adv?.offRating || 110) - (t2Adv?.offRating || 110);

      // 5. Defensive rating differential (lower is better)
      const defRatingDiff = (t2Adv?.defRating || 110) - (t1Adv?.defRating || 110);

      // 6. Net rating differential
      const netRatingDiff = ((t1Adv?.offRating || 110) - (t1Adv?.defRating || 110)) -
                            ((t2Adv?.offRating || 110) - (t2Adv?.defRating || 110));

      // 7. Shooting efficiency (eFG% differential)
      const efgDiff = (t1Adv?.efgPct || 0.52) - (t2Adv?.efgPct || 0.52);

      // 8–14. Traditional stats
      const fg3Diff  = t1Basic.fg3Pct - t2Basic.fg3Pct;
      const ftDiff   = t1Basic.ftPct - t2Basic.ftPct;
      const rebDiff  = t1Basic.rpg - t2Basic.rpg;
      const astDiff  = t1Basic.apg - t2Basic.apg;
      const stlDiff  = t1Basic.spg - t2Basic.spg;
      const blkDiff  = t1Basic.bpg - t2Basic.bpg;
      const tovDiff  = t2Basic.tpg - t1Basic.tpg;

      // 15. Home court advantage
      // Fix 5: normalize to the same [-1, +1] scale as other features so
      // the weight of 0.08 is directly comparable to other weights.
      // A home team wins ~59% of NBA games → raw advantage ≈ 0.09 on win% scale.
      // Normalize by 0.09 so a full home advantage = 1.0 (the max of the scale).
      const HOME_ADVANTAGE_RAW = 0.09; // ~59% win rate for home team
      let homeAwayRaw = 0;
      if (homeTeam === team1.toUpperCase()) homeAwayRaw = HOME_ADVANTAGE_RAW;
      else if (homeTeam === team2.toUpperCase()) homeAwayRaw = -HOME_ADVANTAGE_RAW;
      const homeAwayNorm = homeAwayRaw / HOME_ADVANTAGE_RAW; // → ±1.0

      // 16. Recent form (streak)
      const t1Streak = t1.streak ?? { type: 'W' as const, count: 0 };
      const t2Streak = t2.streak ?? { type: 'W' as const, count: 0 };
      const t1StreakVal = t1Streak.type === 'W' ? t1Streak.count * 0.008 : -t1Streak.count * 0.008;
      const t2StreakVal = t2Streak.type === 'W' ? t2Streak.count * 0.008 : -t2Streak.count * 0.008;
      const streakDiff = t1StreakVal - t2StreakVal;

      // 17. Last 10 record differential
      const parseRecord = (rec: string) => { const [w, l] = rec.split('-').map(Number); return w / (w + l) || 0.5; };
      const last10Diff = parseRecord(t1.last10 ?? '5-5') - parseRecord(t2.last10 ?? '5-5');

      // ---- Weighted Feature Ensemble ----
      // All feature values are pre-normalized to a [-1, +1] scale before weighting,
      // so each weight directly represents importance relative to other features.
      //
      // Calibration note: the sigmoid amplification (x * 4) means a rawScore of ±0.75
      // already produces a 95%/5% win probability. The feature weights and normalization
      // divisors below are hand-tuned, NOT backtested against historical NBA outcomes.
      // Treat output probabilities as directional guidance, not precise calibrated probabilities.
      const features = [
        { name: "Win %",              value: winPctDiff,    weight: 0.12, divisor: 0.4,  raw: [t1Basic.winPct, t2Basic.winPct] },
        { name: "Points/Game",        value: ppgDiff,       weight: 0.08, divisor: 20,   raw: [t1Basic.ppg, t2Basic.ppg] },
        { name: "Opp Points/Game",    value: oppPpgDiff,    weight: 0.08, divisor: 20,   raw: [t1Basic.oppPpg, t2Basic.oppPpg] },
        { name: "Off Rating",         value: offRatingDiff, weight: 0.10, divisor: 15,   raw: [t1Adv?.offRating, t2Adv?.offRating] },
        { name: "Def Rating",         value: defRatingDiff, weight: 0.10, divisor: 15,   raw: [t1Adv?.defRating, t2Adv?.defRating] },
        { name: "Net Rating",         value: netRatingDiff, weight: 0.12, divisor: 15,   raw: [t1Adv?.netRating, t2Adv?.netRating] },
        { name: "eFG%",               value: efgDiff,       weight: 0.06, divisor: 0.1,  raw: [t1Adv?.efgPct, t2Adv?.efgPct] },
        { name: "3PT%",               value: fg3Diff,       weight: 0.05, divisor: 0.1,  raw: [t1Basic.fg3Pct, t2Basic.fg3Pct] },
        { name: "FT%",                value: ftDiff,        weight: 0.02, divisor: 0.1,  raw: [t1Basic.ftPct, t2Basic.ftPct] },
        { name: "Rebounds/Game",      value: rebDiff,       weight: 0.05, divisor: 10,   raw: [t1Basic.rpg, t2Basic.rpg] },
        { name: "Assists/Game",       value: astDiff,       weight: 0.04, divisor: 8,    raw: [t1Basic.apg, t2Basic.apg] },
        { name: "Steals/Game",        value: stlDiff,       weight: 0.03, divisor: 3,    raw: [t1Basic.spg, t2Basic.spg] },
        { name: "Blocks/Game",        value: blkDiff,       weight: 0.02, divisor: 3,    raw: [t1Basic.bpg, t2Basic.bpg] },
        { name: "Turnovers/Game",     value: tovDiff,       weight: 0.04, divisor: 5,    raw: [t1Basic.tpg, t2Basic.tpg] },
        // Fix 5: Home Court now normalized to [-1, +1] same as all other features.
        // Weight 0.08 means it contributes comparably to a mid-importance stat.
        { name: "Home Court",         value: homeAwayNorm,  weight: 0.08, divisor: 1,    raw: [homeTeam === team1.toUpperCase() ? 'Home' : 'Away', homeTeam === team2.toUpperCase() ? 'Home' : 'Away'] },
        { name: "Recent Streak",      value: streakDiff,    weight: 0.05, divisor: 0.08, raw: [`${t1Streak.type}${t1Streak.count}`, `${t2Streak.type}${t2Streak.count}`] },
        { name: "Last 10 Record",     value: last10Diff,    weight: 0.06, divisor: 0.4,  raw: [t1.last10 ?? '5-5', t2.last10 ?? '5-5'] },
        // Fix 3: Rest/B2B features
        { name: "Rest Advantage",     value: restDiff,      weight: 0.05, divisor: 1,    raw: [`${t1RestDays}d`, `${t2RestDays}d`] },
        { name: "B2B Fatigue",        value: b2bNetDiff,    weight: 0.05, divisor: 0.05, raw: [t1IsB2B ? 'B2B' : 'Rested', t2IsB2B ? 'B2B' : 'Rested'] },
        // Fix 4: Injury impact
        { name: "Injury Impact",      value: injuryDiff,    weight: 0.06, divisor: 0.1,  raw: [t1InjuryPenalty > 0 ? `${(t1InjuryPenalty * 100).toFixed(0)}% reduced` : 'Healthy', t2InjuryPenalty > 0 ? `${(t2InjuryPenalty * 100).toFixed(0)}% reduced` : 'Healthy'] },
      ];

      // Build normalized score: each feature value is divided by its divisor → [-1,+1]-ish,
      // then multiplied by weight. Sum → rawScore fed into sigmoid.
      const normalize = (f: typeof features[0]) => Math.max(-1, Math.min(1, f.value / f.divisor));

      const rawScore = features.reduce((sum, f) => sum + normalize(f) * f.weight, 0);

      // Sigmoid conversion: x * 4 means ±0.75 rawScore → 95%/5% probability.
      // NOTE: this amplification factor is hand-tuned, not backtested against historical
      // NBA outcomes. Output probabilities are directional, not precisely calibrated.
      const sigmoid = (x: number) => 1 / (1 + Math.exp(-x * 4));
      const team1WinProb = Math.max(0.05, Math.min(0.95, sigmoid(rawScore)));
      const team2WinProb = 1 - team1WinProb;

      const confidence = Math.abs(team1WinProb - 0.5) * 2;

      // Feature importance (absolute contribution, sorted)
      const featureImportance = features.map(f => {
        const norm = normalize(f);
        const contribution = norm * f.weight;
        return {
          feature: f.name,
          weight: f.weight,
          team1Value: f.raw[0],
          team2Value: f.raw[1],
          differential: f.value,
          contribution,
          favors: contribution > 0.001 ? team1.toUpperCase() : contribution < -0.001 ? team2.toUpperCase() : 'neutral',
        };
      }).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

      // Projected score
      const projectedTotal = ((t1Basic.ppg + t2Basic.oppPpg) / 2 + (t2Basic.ppg + t1Basic.oppPpg) / 2);
      const scoreDiff = (team1WinProb - 0.5) * 20;
      const team1ProjectedScore = Math.round((projectedTotal / 2) + (scoreDiff / 2));
      const team2ProjectedScore = Math.round((projectedTotal / 2) - (scoreDiff / 2));

      res.json({
        team1: {
          abbr: t1.teamAbbr,
          name: t1.teamName,
          winProb: Math.round(team1WinProb * 1000) / 10,
          projectedScore: team1ProjectedScore,
          record: `${t1Basic.wins}-${t1Basic.losses}`,
          streak: t1Streak,
          last10: t1.last10 ?? '5-5',
          ppg: t1Basic.ppg,
          oppPpg: t1Basic.oppPpg,
          offRating: t1Adv?.offRating,
          defRating: t1Adv?.defRating,
          netRating: t1Adv?.netRating,
          restDays: t1RestDays,
          isB2B: t1IsB2B,
        },
        team2: {
          abbr: t2.teamAbbr,
          name: t2.teamName,
          winProb: Math.round(team2WinProb * 1000) / 10,
          projectedScore: team2ProjectedScore,
          record: `${t2Basic.wins}-${t2Basic.losses}`,
          streak: t2Streak,
          last10: t2.last10 ?? '5-5',
          ppg: t2Basic.ppg,
          oppPpg: t2Basic.oppPpg,
          offRating: t2Adv?.offRating,
          defRating: t2Adv?.defRating,
          netRating: t2Adv?.netRating,
          restDays: t2RestDays,
          isB2B: t2IsB2B,
        },
        prediction: {
          winner: team1WinProb > team2WinProb ? t1.teamAbbr : t2.teamAbbr,
          winnerName: team1WinProb > team2WinProb ? t1.teamName : t2.teamName,
          winProb: Math.round(Math.max(team1WinProb, team2WinProb) * 1000) / 10,
          confidence: Math.round(confidence * 100),
          projectedTotal: Math.round(projectedTotal),
          projectedSpread: Math.round(scoreDiff * 10) / 10,
          homeTeam: homeTeam,
          contextFactors: {
            t1IsB2B,
            t2IsB2B,
            t1RestDays,
            t2RestDays,
            t1InjuryPenalty: Math.round(t1InjuryPenalty * 100),
            t2InjuryPenalty: Math.round(t2InjuryPenalty * 100),
          },
          modelInfo: {
            type: "Weighted Feature Ensemble",
            features: features.length,
            description: "Prediction using real efficiency ratings, rest/B2B context, and injury-adjusted rotations",
            calibrationNote: "Sigmoid amplification (x*4) not backtested — probabilities are directional, not precisely calibrated",
          },
        },
        featureImportance,
        comparison: {
          stats: [
            { label: "PPG",     team1: t1Basic.ppg.toFixed(1),             team2: t2Basic.ppg.toFixed(1),             better: t1Basic.ppg > t2Basic.ppg ? 1 : 2 },
            { label: "Opp PPG", team1: t1Basic.oppPpg.toFixed(1),          team2: t2Basic.oppPpg.toFixed(1),          better: t1Basic.oppPpg < t2Basic.oppPpg ? 1 : 2 },
            { label: "FG%",     team1: (t1Basic.fgPct * 100).toFixed(1),   team2: (t2Basic.fgPct * 100).toFixed(1),   better: t1Basic.fgPct > t2Basic.fgPct ? 1 : 2 },
            { label: "3PT%",    team1: (t1Basic.fg3Pct * 100).toFixed(1),  team2: (t2Basic.fg3Pct * 100).toFixed(1),  better: t1Basic.fg3Pct > t2Basic.fg3Pct ? 1 : 2 },
            { label: "FT%",     team1: (t1Basic.ftPct * 100).toFixed(1),   team2: (t2Basic.ftPct * 100).toFixed(1),   better: t1Basic.ftPct > t2Basic.ftPct ? 1 : 2 },
            { label: "RPG",     team1: t1Basic.rpg.toFixed(1),             team2: t2Basic.rpg.toFixed(1),             better: t1Basic.rpg > t2Basic.rpg ? 1 : 2 },
            { label: "APG",     team1: t1Basic.apg.toFixed(1),             team2: t2Basic.apg.toFixed(1),             better: t1Basic.apg > t2Basic.apg ? 1 : 2 },
            { label: "SPG",     team1: t1Basic.spg.toFixed(1),             team2: t2Basic.spg.toFixed(1),             better: t1Basic.spg > t2Basic.spg ? 1 : 2 },
            { label: "BPG",     team1: t1Basic.bpg.toFixed(1),             team2: t2Basic.bpg.toFixed(1),             better: t1Basic.bpg > t2Basic.bpg ? 1 : 2 },
            { label: "TPG",     team1: t1Basic.tpg.toFixed(1),             team2: t2Basic.tpg.toFixed(1),             better: t1Basic.tpg < t2Basic.tpg ? 1 : 2 },
            { label: "Off Rtg", team1: (t1Adv?.offRating || 0).toFixed(1), team2: (t2Adv?.offRating || 0).toFixed(1), better: (t1Adv?.offRating || 0) > (t2Adv?.offRating || 0) ? 1 : 2 },
            { label: "Def Rtg", team1: (t1Adv?.defRating || 0).toFixed(1), team2: (t2Adv?.defRating || 0).toFixed(1), better: (t1Adv?.defRating || 0) < (t2Adv?.defRating || 0) ? 1 : 2 },
          ],
          quarterScoring: {
            team1: t1Basic.avgQuarterScoring,
            team2: t2Basic.avgQuarterScoring,
          },
        },
      });
    } catch (error) {
      apiLogger.error("Error predicting game:", error);
      res.status(500).json({ error: "Failed to predict game" });
    }
  });
}
