/**
 * CourtSide Edge - Referee Foul Signal API Routes
 * ================================================
 * Add these routes to your existing Express server in HoopStats.
 * 
 * Integration:
 *   // In your main server/routes.ts or server/index.ts
 *   import { registerRefSignalRoutes } from './routes/ref-signal';
 *   registerRefSignalRoutes(app);
 */

import { Express, Request, Response } from 'express';

// ─── REFEREE DATABASE ─────────────────────────────────────────────
const LEAGUE_AVG_FOULS_PG = 37.8;

interface RefData {
  name: string;
  fouls_pg: number;
  fta_pg: number;
  techs: number;
  over_rate: number;
  diff_vs_avg: number;
  tier: string;
  exp_yrs: number;
}

interface PlayerFoulData {
  name: string;
  team: string;
  pos: string;
  pf_pg: number;
  pf_36: number;
  foul_tier: string;
  std_dev: number;
}

const REFEREE_DB: Record<string, Omit<RefData, 'name'>> = {
  "Tony Brothers":     { fouls_pg: 42.3, fta_pg: 48.1, techs: 15, over_rate: 0.58, diff_vs_avg: 4.5,  tier: "HIGH",     exp_yrs: 30 },
  "Scott Foster":      { fouls_pg: 41.8, fta_pg: 47.5, techs: 12, over_rate: 0.55, diff_vs_avg: 4.0,  tier: "HIGH",     exp_yrs: 30 },
  "Kane Fitzgerald":   { fouls_pg: 41.2, fta_pg: 46.8, techs: 10, over_rate: 0.54, diff_vs_avg: 3.4,  tier: "HIGH",     exp_yrs: 15 },
  "James Williams":    { fouls_pg: 40.8, fta_pg: 46.5, techs: 18, over_rate: 0.55, diff_vs_avg: 3.0,  tier: "HIGH",     exp_yrs: 8  },
  "Ed Malloy":         { fouls_pg: 40.5, fta_pg: 45.9, techs: 9,  over_rate: 0.53, diff_vs_avg: 2.7,  tier: "HIGH",     exp_yrs: 22 },
  "Andy Nagy":         { fouls_pg: 39.9, fta_pg: 46.2, techs: 8,  over_rate: 0.56, diff_vs_avg: 2.1,  tier: "HIGH",     exp_yrs: 4  },
  "Curtis Blair":      { fouls_pg: 40.1, fta_pg: 45.3, techs: 7,  over_rate: 0.52, diff_vs_avg: 2.3,  tier: "HIGH",     exp_yrs: 10 },
  "Brent Barnaky":     { fouls_pg: 39.8, fta_pg: 44.8, techs: 6,  over_rate: 0.51, diff_vs_avg: 2.0,  tier: "MID-HIGH", exp_yrs: 6  },
  "Bill Kennedy":      { fouls_pg: 39.5, fta_pg: 44.5, techs: 11, over_rate: 0.51, diff_vs_avg: 1.7,  tier: "MID-HIGH", exp_yrs: 28 },
  "Sean Corbin":       { fouls_pg: 39.2, fta_pg: 44.2, techs: 8,  over_rate: 0.50, diff_vs_avg: 1.4,  tier: "MID-HIGH", exp_yrs: 20 },
  "Rodney Mott":       { fouls_pg: 39.0, fta_pg: 43.8, techs: 7,  over_rate: 0.49, diff_vs_avg: 1.2,  tier: "MID",      exp_yrs: 18 },
  "Leon Wood":         { fouls_pg: 38.7, fta_pg: 43.5, techs: 6,  over_rate: 0.48, diff_vs_avg: 0.9,  tier: "MID",      exp_yrs: 17 },
  "Sha'Rae Mitchell":  { fouls_pg: 38.8, fta_pg: 43.6, techs: 3,  over_rate: 0.49, diff_vs_avg: 1.0,  tier: "MID",      exp_yrs: 3  },
  "Marc Davis":        { fouls_pg: 38.0, fta_pg: 42.8, techs: 9,  over_rate: 0.46, diff_vs_avg: 0.2,  tier: "MID",      exp_yrs: 25 },
  "Zach Zarba":        { fouls_pg: 37.8, fta_pg: 42.5, techs: 8,  over_rate: 0.45, diff_vs_avg: 0.0,  tier: "MID",      exp_yrs: 18 },
  "Josh Tiven":        { fouls_pg: 37.5, fta_pg: 42.2, techs: 7,  over_rate: 0.44, diff_vs_avg: -0.3, tier: "MID",      exp_yrs: 12 },
  "Ben Taylor":        { fouls_pg: 37.2, fta_pg: 41.8, techs: 5,  over_rate: 0.43, diff_vs_avg: -0.6, tier: "MID-LOW",  exp_yrs: 8  },
  "JB DeRosa":         { fouls_pg: 37.0, fta_pg: 41.5, techs: 6,  over_rate: 0.42, diff_vs_avg: -0.8, tier: "MID-LOW",  exp_yrs: 14 },
  "Derrick Collins":   { fouls_pg: 36.8, fta_pg: 41.2, techs: 4,  over_rate: 0.41, diff_vs_avg: -1.0, tier: "MID-LOW",  exp_yrs: 9  },
  "Eric Lewis":        { fouls_pg: 36.5, fta_pg: 40.8, techs: 5,  over_rate: 0.40, diff_vs_avg: -1.3, tier: "LOW",      exp_yrs: 16 },
  "Karl Lane":         { fouls_pg: 36.2, fta_pg: 40.5, techs: 3,  over_rate: 0.39, diff_vs_avg: -1.6, tier: "LOW",      exp_yrs: 6  },
  "Marat Kogut":       { fouls_pg: 36.0, fta_pg: 40.2, techs: 4,  over_rate: 0.38, diff_vs_avg: -1.8, tier: "LOW",      exp_yrs: 10 },
  "John Goble":        { fouls_pg: 35.5, fta_pg: 39.5, techs: 5,  over_rate: 0.36, diff_vs_avg: -2.3, tier: "LOW",      exp_yrs: 17 },
  "Tyler Ford":        { fouls_pg: 35.2, fta_pg: 39.2, techs: 4,  over_rate: 0.35, diff_vs_avg: -2.6, tier: "LOW",      exp_yrs: 8  },
};

const PLAYER_FOUL_DB: Record<string, Omit<PlayerFoulData, 'name'>> = {
  "Jaren Jackson Jr.":      { team: "MEM", pos: "PF", pf_pg: 3.8, pf_36: 4.3, foul_tier: "VERY_HIGH", std_dev: 1.1 },
  "Chet Holmgren":          { team: "OKC", pos: "PF", pf_pg: 3.6, pf_36: 4.3, foul_tier: "VERY_HIGH", std_dev: 1.0 },
  "Alperen Sengun":         { team: "HOU", pos: "C",  pf_pg: 3.5, pf_36: 3.9, foul_tier: "VERY_HIGH", std_dev: 1.0 },
  "Walker Kessler":         { team: "UTA", pos: "C",  pf_pg: 3.1, pf_36: 4.6, foul_tier: "VERY_HIGH", std_dev: 1.1 },
  "Jalen Duren":            { team: "DET", pos: "C",  pf_pg: 3.3, pf_36: 4.2, foul_tier: "VERY_HIGH", std_dev: 1.0 },
  "Daniel Gafford":         { team: "DAL", pos: "C",  pf_pg: 2.8, pf_36: 4.6, foul_tier: "VERY_HIGH", std_dev: 0.9 },
  "Giannis Antetokounmpo":  { team: "MIL", pos: "PF", pf_pg: 3.5, pf_36: 3.5, foul_tier: "HIGH",      std_dev: 0.9 },
  "Victor Wembanyama":      { team: "SAS", pos: "C",  pf_pg: 3.4, pf_36: 3.7, foul_tier: "HIGH",      std_dev: 1.0 },
  "Nikola Jokic":           { team: "DEN", pos: "C",  pf_pg: 3.3, pf_36: 3.3, foul_tier: "HIGH",      std_dev: 0.8 },
  "Rudy Gobert":            { team: "MIN", pos: "C",  pf_pg: 3.3, pf_36: 3.9, foul_tier: "HIGH",      std_dev: 0.9 },
  "Domantas Sabonis":       { team: "SAC", pos: "C",  pf_pg: 3.2, pf_36: 3.3, foul_tier: "HIGH",      std_dev: 0.8 },
  "Karl-Anthony Towns":     { team: "NYK", pos: "C",  pf_pg: 3.2, pf_36: 3.3, foul_tier: "HIGH",      std_dev: 0.9 },
  "Brook Lopez":            { team: "MIL", pos: "C",  pf_pg: 3.1, pf_36: 3.9, foul_tier: "HIGH",      std_dev: 0.9 },
  "Joel Embiid":            { team: "PHI", pos: "C",  pf_pg: 3.1, pf_36: 3.3, foul_tier: "HIGH",      std_dev: 0.9 },
  "Bam Adebayo":            { team: "MIA", pos: "C",  pf_pg: 3.0, pf_36: 3.1, foul_tier: "HIGH",      std_dev: 0.8 },
  "Scottie Barnes":         { team: "TOR", pos: "PF", pf_pg: 3.0, pf_36: 3.1, foul_tier: "HIGH",      std_dev: 0.8 },
  "Anthony Davis":          { team: "LAL", pos: "PF", pf_pg: 2.8, pf_36: 2.8, foul_tier: "MID_HIGH",  std_dev: 0.8 },
  "Luka Doncic":            { team: "LAL", pos: "PG", pf_pg: 2.8, pf_36: 2.8, foul_tier: "MID_HIGH",  std_dev: 0.8 },
  "Anthony Edwards":        { team: "MIN", pos: "SG", pf_pg: 2.5, pf_36: 2.5, foul_tier: "MID",       std_dev: 0.7 },
  "Jayson Tatum":           { team: "BOS", pos: "SF", pf_pg: 2.3, pf_36: 2.3, foul_tier: "MID",       std_dev: 0.6 },
  "Shai Gilgeous-Alexander":{ team: "OKC", pos: "PG", pf_pg: 2.2, pf_36: 2.3, foul_tier: "MID",       std_dev: 0.6 },
  "LeBron James":           { team: "LAL", pos: "SF", pf_pg: 1.8, pf_36: 1.9, foul_tier: "LOW",       std_dev: 0.5 },
  "Trae Young":             { team: "ATL", pos: "PG", pf_pg: 1.5, pf_36: 1.5, foul_tier: "VERY_LOW",  std_dev: 0.4 },
};

const TIER_UPLIFT: Record<string, number> = {
  "HIGH":     0.11,
  "MID-HIGH": 0.055,
  "MID":      0.00,
  "MID-LOW": -0.04,
  "LOW":     -0.06,
};

// ─── SIGNAL CALCULATOR ────────────────────────────────────────────

function getCrewCompositeTier(refs: string[]) {
  const found = refs.map(r => REFEREE_DB[r]).filter(Boolean);
  if (!found.length) return { tier: "UNKNOWN", avg_fouls_pg: LEAGUE_AVG_FOULS_PG, uplift: 0 };

  const avgDiff = found.reduce((s, r) => s + r.diff_vs_avg, 0) / found.length;
  const avgFouls = found.reduce((s, r) => s + r.fouls_pg, 0) / found.length;

  let tier: string;
  if (avgDiff >= 2.0) tier = "HIGH";
  else if (avgDiff >= 1.0) tier = "MID-HIGH";
  else if (avgDiff >= -0.5) tier = "MID";
  else if (avgDiff >= -1.5) tier = "MID-LOW";
  else tier = "LOW";

  return {
    tier,
    avg_fouls_pg: Math.round(avgFouls * 10) / 10,
    diff_vs_avg: Math.round(avgDiff * 10) / 10,
    uplift: TIER_UPLIFT[tier] ?? 0,
    refs_found: found.length,
    ref_details: refs.map(name => ({
      name,
      ...(REFEREE_DB[name] || { fouls_pg: null, tier: "UNKNOWN" }),
    })),
  };
}

function calculateSignal(
  playerName: string,
  refs: string[],
  line?: number,
  paceFactor = 1.0,
  b2b = false,
) {
  const player = PLAYER_FOUL_DB[playerName];
  if (!player) return null;

  const crew = getCrewCompositeTier(refs);
  let projected = player.pf_pg * (1 + crew.uplift) * paceFactor;
  if (b2b) projected += 0.2;
  projected = Math.round(projected * 100) / 100;

  const defaultLines: Record<string, number> = {
    VERY_HIGH: 3.5, HIGH: 3.5, MID_HIGH: 3.5,
    MID: 2.5, LOW_MID: 2.5, LOW: 1.5, VERY_LOW: 1.5,
  };
  const effectiveLine = line ?? defaultLines[player.foul_tier] ?? 2.5;
  const signal = Math.round(((projected - effectiveLine) / player.std_dev) * 100) / 100;

  let action: string, confidence: string;
  if (signal >= 1.5)       { action = "SMASH_OVER";   confidence = "VERY_HIGH"; }
  else if (signal >= 1.0)  { action = "STRONG_OVER";  confidence = "HIGH"; }
  else if (signal >= 0.5)  { action = "LEAN_OVER";    confidence = "MID"; }
  else if (signal <= -1.5) { action = "SMASH_UNDER";  confidence = "VERY_HIGH"; }
  else if (signal <= -1.0) { action = "STRONG_UNDER"; confidence = "HIGH"; }
  else if (signal <= -0.5) { action = "LEAN_UNDER";   confidence = "MID"; }
  else                     { action = "NO_PLAY";      confidence = "NONE"; }

  return {
    player: playerName,
    team: player.team,
    position: player.pos,
    foul_tier: player.foul_tier,
    base_pf_pg: player.pf_pg,
    ref_crew_tier: crew.tier,
    ref_uplift_pct: Math.round(crew.uplift * 1000) / 10,
    pace_factor: paceFactor,
    b2b,
    projected_pf: projected,
    prizepicks_line: effectiveLine,
    signal_strength: signal,
    action,
    confidence,
    ref_details: crew.ref_details,
  };
}

// ─── ROUTE REGISTRATION ──────────────────────────────────────────

export function registerRefSignalRoutes(app: Express) {

  // GET all referees ranked by fouls/game
  app.get('/api/ref-signal/referees', (_req: Request, res: Response) => {
    const refs = Object.entries(REFEREE_DB)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.fouls_pg - a.fouls_pg);
    res.json(refs);
  });

  // GET all tracked foul-prone players
  app.get('/api/ref-signal/players', (_req: Request, res: Response) => {
    const players = Object.entries(PLAYER_FOUL_DB)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.pf_pg - a.pf_pg);
    res.json(players);
  });

  // POST calculate signal for single player
  app.post('/api/ref-signal/calculate', (req: Request, res: Response) => {
    const { player, refs, line, pace_factor, b2b } = req.body;
    if (!player || !refs?.length) {
      return res.status(400).json({ error: "player and refs[] required" });
    }
    const result = calculateSignal(player, refs, line, pace_factor, b2b);
    if (!result) return res.status(404).json({ error: "Player not found" });
    res.json(result);
  });

  // POST scan all players for a game
  app.post('/api/ref-signal/scan-game', (req: Request, res: Response) => {
    const { refs, teams, pace_factor = 1.0, b2b_teams = [] } = req.body;
    if (!refs?.length || !teams?.length) {
      return res.status(400).json({ error: "refs[] and teams[] required" });
    }

    const signals: any[] = [];
    for (const [name, data] of Object.entries(PLAYER_FOUL_DB)) {
      if (teams.includes(data.team)) {
        const result = calculateSignal(name, refs, undefined, pace_factor, b2b_teams.includes(data.team));
        if (result && result.action !== "NO_PLAY") {
          signals.push(result);
        }
      }
    }
    signals.sort((a, b) => Math.abs(b.signal_strength) - Math.abs(a.signal_strength));
    res.json(signals);
  });

  // GET ref lookup by name
  app.get('/api/ref-signal/referee/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    const ref = REFEREE_DB[name];
    if (!ref) return res.status(404).json({ error: "Referee not found" });
    res.json({ name, ...ref });
  });

  console.log('✅ Ref Foul Signal routes registered');
}
