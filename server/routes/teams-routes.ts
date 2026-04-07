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

      // ---- Feature Engineering (inspired by NBA-Game-Predictor's 130+ features) ----

      // 1. Win percentage differential (season-to-date)
      const winPctDiff = t1Basic.winPct - t2Basic.winPct;

      // 2. Points per game differential (rolling avg proxy)
      const ppgDiff = t1Basic.ppg - t2Basic.ppg;

      // 3. Opponent PPG differential (defensive strength)
      const oppPpgDiff = t2Basic.oppPpg - t1Basic.oppPpg; // higher opp ppg = weaker defense

      // 4. Offensive rating differential
      const offRatingDiff = (t1Adv?.offRating || 110) - (t2Adv?.offRating || 110);

      // 5. Defensive rating differential (lower is better)
      const defRatingDiff = (t2Adv?.defRating || 110) - (t1Adv?.defRating || 110);

      // 6. Net rating differential
      const netRatingDiff = ((t1Adv?.offRating || 110) - (t1Adv?.defRating || 110)) -
                            ((t2Adv?.offRating || 110) - (t2Adv?.defRating || 110));

      // 7. Shooting efficiency (eFG% differential)
      const efgDiff = (t1Adv?.efgPct || 0.52) - (t2Adv?.efgPct || 0.52);

      // 8. Three-point shooting differential
      const fg3Diff = t1Basic.fg3Pct - t2Basic.fg3Pct;

      // 9. Free throw percentage differential
      const ftDiff = t1Basic.ftPct - t2Basic.ftPct;

      // 10. Rebounding differential
      const rebDiff = t1Basic.rpg - t2Basic.rpg;

      // 11. Assists differential
      const astDiff = t1Basic.apg - t2Basic.apg;

      // 12. Steals differential
      const stlDiff = t1Basic.spg - t2Basic.spg;

      // 13. Blocks differential
      const blkDiff = t1Basic.bpg - t2Basic.bpg;

      // 14. Turnover differential (fewer is better, so t2 - t1)
      const tovDiff = t2Basic.tpg - t1Basic.tpg;

      // 15. Home/Away adjustment
      let homeAwayAdj = 0;
      if (homeTeam === team1.toUpperCase()) {
        homeAwayAdj = 0.03; // ~3% home court advantage
      } else if (homeTeam === team2.toUpperCase()) {
        homeAwayAdj = -0.03;
      }

      // 16. Recent form (streak bonus)
      const t1StreakVal = t1.streak.type === 'W' ? t1.streak.count * 0.008 : -t1.streak.count * 0.008;
      const t2StreakVal = t2.streak.type === 'W' ? t2.streak.count * 0.008 : -t2.streak.count * 0.008;
      const streakDiff = t1StreakVal - t2StreakVal;

      // 17. Last 10 record differential
      const parseRecord = (rec: string) => { const [w, l] = rec.split('-').map(Number); return w / (w + l) || 0.5; };
      const last10Diff = parseRecord(t1.last10) - parseRecord(t2.last10);

      // ---- Weighted Ensemble (XGBoost-inspired feature weights) ----
      // Weights reflect feature importance from the reference model
      const features = [
        { name: "Win %",              value: winPctDiff,    weight: 0.12, raw: [t1Basic.winPct, t2Basic.winPct] },
        { name: "Points/Game",        value: ppgDiff,       weight: 0.08, raw: [t1Basic.ppg, t2Basic.ppg] },
        { name: "Opp Points/Game",    value: oppPpgDiff,    weight: 0.08, raw: [t1Basic.oppPpg, t2Basic.oppPpg] },
        { name: "Off Rating",         value: offRatingDiff, weight: 0.10, raw: [t1Adv?.offRating, t2Adv?.offRating] },
        { name: "Def Rating",         value: defRatingDiff, weight: 0.10, raw: [t1Adv?.defRating, t2Adv?.defRating] },
        { name: "Net Rating",         value: netRatingDiff, weight: 0.12, raw: [t1Adv?.netRating, t2Adv?.netRating] },
        { name: "eFG%",               value: efgDiff,       weight: 0.06, raw: [t1Adv?.efgPct, t2Adv?.efgPct] },
        { name: "3PT%",               value: fg3Diff,       weight: 0.05, raw: [t1Basic.fg3Pct, t2Basic.fg3Pct] },
        { name: "FT%",                value: ftDiff,        weight: 0.02, raw: [t1Basic.ftPct, t2Basic.ftPct] },
        { name: "Rebounds/Game",      value: rebDiff,       weight: 0.05, raw: [t1Basic.rpg, t2Basic.rpg] },
        { name: "Assists/Game",       value: astDiff,       weight: 0.04, raw: [t1Basic.apg, t2Basic.apg] },
        { name: "Steals/Game",        value: stlDiff,       weight: 0.03, raw: [t1Basic.spg, t2Basic.spg] },
        { name: "Blocks/Game",        value: blkDiff,       weight: 0.02, raw: [t1Basic.bpg, t2Basic.bpg] },
        { name: "Turnovers/Game",     value: tovDiff,       weight: 0.04, raw: [t1Basic.tpg, t2Basic.tpg] },
        { name: "Home Court",         value: homeAwayAdj,   weight: 1.00, raw: [homeTeam === team1.toUpperCase() ? 1 : 0, homeTeam === team2.toUpperCase() ? 1 : 0] },
        { name: "Recent Streak",      value: streakDiff,    weight: 0.05, raw: [`${t1.streak.type}${t1.streak.count}`, `${t2.streak.type}${t2.streak.count}`] },
        { name: "Last 10 Record",     value: last10Diff,    weight: 0.06, raw: [t1.last10, t2.last10] },
      ];

      // Normalize feature contributions
      // Use sigmoid-like scaling for the weighted sum
      const rawScore = features.reduce((sum, f) => {
        // Normalize each feature's value to a reasonable scale before weighting
        let normalizedValue = f.value;
        if (f.name === "Points/Game" || f.name === "Opp Points/Game") normalizedValue /= 20; // Scale by max reasonable diff
        else if (f.name === "Off Rating" || f.name === "Def Rating" || f.name === "Net Rating") normalizedValue /= 15;
        else if (f.name === "eFG%") normalizedValue /= 0.1;
        else if (f.name === "3PT%" || f.name === "FT%") normalizedValue /= 0.1;
        else if (f.name === "Rebounds/Game") normalizedValue /= 10;
        else if (f.name === "Assists/Game") normalizedValue /= 8;
        else if (f.name === "Steals/Game" || f.name === "Blocks/Game") normalizedValue /= 3;
        else if (f.name === "Turnovers/Game") normalizedValue /= 5;
        else if (f.name === "Win %" || f.name === "Last 10 Record") normalizedValue /= 0.4;

        return sum + (normalizedValue * f.weight);
      }, 0);

      // Sigmoid to convert to probability
      const sigmoid = (x: number) => 1 / (1 + Math.exp(-x * 4));
      const team1WinProb = Math.max(0.05, Math.min(0.95, sigmoid(rawScore)));
      const team2WinProb = 1 - team1WinProb;

      // Confidence based on how far from 50/50
      const confidence = Math.abs(team1WinProb - 0.5) * 2; // 0 to 1

      // Feature importance (absolute contribution, sorted)
      const featureImportance = features
        .filter(f => f.name !== "Home Court") // Home court is a direct adjustment
        .map(f => {
          let normalizedValue = f.value;
          if (f.name === "Points/Game" || f.name === "Opp Points/Game") normalizedValue /= 20;
          else if (f.name === "Off Rating" || f.name === "Def Rating" || f.name === "Net Rating") normalizedValue /= 15;
          else if (f.name === "eFG%") normalizedValue /= 0.1;
          else if (f.name === "3PT%" || f.name === "FT%") normalizedValue /= 0.1;
          else if (f.name === "Rebounds/Game") normalizedValue /= 10;
          else if (f.name === "Assists/Game") normalizedValue /= 8;
          else if (f.name === "Steals/Game" || f.name === "Blocks/Game") normalizedValue /= 3;
          else if (f.name === "Turnovers/Game") normalizedValue /= 5;
          else if (f.name === "Win %" || f.name === "Last 10 Record") normalizedValue /= 0.4;

          const contribution = normalizedValue * f.weight;
          return {
            feature: f.name,
            weight: f.weight,
            team1Value: f.raw[0],
            team2Value: f.raw[1],
            differential: f.value,
            contribution,
            favors: contribution > 0 ? team1.toUpperCase() : contribution < 0 ? team2.toUpperCase() : 'neutral',
          };
        })
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

      // Projected score
      const projectedTotal = ((t1Basic.ppg + t2Basic.oppPpg) / 2 + (t2Basic.ppg + t1Basic.oppPpg) / 2);
      const scoreDiff = (team1WinProb - 0.5) * 20; // Rough spread estimate
      const team1ProjectedScore = Math.round((projectedTotal / 2) + (scoreDiff / 2));
      const team2ProjectedScore = Math.round((projectedTotal / 2) - (scoreDiff / 2));

      res.json({
        team1: {
          abbr: t1.teamAbbr,
          name: t1.teamName,
          winProb: Math.round(team1WinProb * 1000) / 10,
          projectedScore: team1ProjectedScore,
          record: `${t1Basic.wins}-${t1Basic.losses}`,
          streak: t1.streak,
          last10: t1.last10,
          ppg: t1Basic.ppg,
          oppPpg: t1Basic.oppPpg,
          offRating: t1Adv?.offRating,
          defRating: t1Adv?.defRating,
          netRating: t1Adv?.netRating,
        },
        team2: {
          abbr: t2.teamAbbr,
          name: t2.teamName,
          winProb: Math.round(team2WinProb * 1000) / 10,
          projectedScore: team2ProjectedScore,
          record: `${t2Basic.wins}-${t2Basic.losses}`,
          streak: t2.streak,
          last10: t2.last10,
          ppg: t2Basic.ppg,
          oppPpg: t2Basic.oppPpg,
          offRating: t2Adv?.offRating,
          defRating: t2Adv?.defRating,
          netRating: t2Adv?.netRating,
        },
        prediction: {
          winner: team1WinProb > team2WinProb ? t1.teamAbbr : t2.teamAbbr,
          winnerName: team1WinProb > team2WinProb ? t1.teamName : t2.teamName,
          winProb: Math.round(Math.max(team1WinProb, team2WinProb) * 1000) / 10,
          confidence: Math.round(confidence * 100),
          projectedTotal: Math.round(projectedTotal),
          projectedSpread: Math.round(scoreDiff * 10) / 10,
          homeTeam: homeTeam,
          modelInfo: {
            type: "Weighted Feature Ensemble",
            features: features.length,
            description: "XGBoost-inspired prediction using rolling averages, efficiency ratings, and contextual features",
          },
        },
        featureImportance,
        comparison: {
          stats: [
            { label: "PPG", team1: t1Basic.ppg.toFixed(1), team2: t2Basic.ppg.toFixed(1), better: t1Basic.ppg > t2Basic.ppg ? 1 : 2 },
            { label: "Opp PPG", team1: t1Basic.oppPpg.toFixed(1), team2: t2Basic.oppPpg.toFixed(1), better: t1Basic.oppPpg < t2Basic.oppPpg ? 1 : 2 },
            { label: "FG%", team1: (t1Basic.fgPct * 100).toFixed(1), team2: (t2Basic.fgPct * 100).toFixed(1), better: t1Basic.fgPct > t2Basic.fgPct ? 1 : 2 },
            { label: "3PT%", team1: (t1Basic.fg3Pct * 100).toFixed(1), team2: (t2Basic.fg3Pct * 100).toFixed(1), better: t1Basic.fg3Pct > t2Basic.fg3Pct ? 1 : 2 },
            { label: "FT%", team1: (t1Basic.ftPct * 100).toFixed(1), team2: (t2Basic.ftPct * 100).toFixed(1), better: t1Basic.ftPct > t2Basic.ftPct ? 1 : 2 },
            { label: "RPG", team1: t1Basic.rpg.toFixed(1), team2: t2Basic.rpg.toFixed(1), better: t1Basic.rpg > t2Basic.rpg ? 1 : 2 },
            { label: "APG", team1: t1Basic.apg.toFixed(1), team2: t2Basic.apg.toFixed(1), better: t1Basic.apg > t2Basic.apg ? 1 : 2 },
            { label: "SPG", team1: t1Basic.spg.toFixed(1), team2: t2Basic.spg.toFixed(1), better: t1Basic.spg > t2Basic.spg ? 1 : 2 },
            { label: "BPG", team1: t1Basic.bpg.toFixed(1), team2: t2Basic.bpg.toFixed(1), better: t1Basic.bpg > t2Basic.bpg ? 1 : 2 },
            { label: "TPG", team1: t1Basic.tpg.toFixed(1), team2: t2Basic.tpg.toFixed(1), better: t1Basic.tpg < t2Basic.tpg ? 1 : 2 },
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
