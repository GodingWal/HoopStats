import { z } from "zod";

// Player game log entry
export const gameLogSchema = z.object({
  GAME_DATE: z.string(),
  OPPONENT: z.string(),
  PTS: z.number(),
  REB: z.number(),
  AST: z.number(),
  FG3M: z.number(),
  WL: z.string(),
  MIN: z.number(),
});

export type GameLog = z.infer<typeof gameLogSchema>;

// Season averages
export const seasonAveragesSchema = z.object({
  PTS: z.number(),
  REB: z.number(),
  AST: z.number(),
  FG3M: z.number(),
  STL: z.number().optional(),
  BLK: z.number().optional(),
  PRA: z.number(),
  MIN: z.number(),
  TOV: z.number().optional(),
});

export type SeasonAverages = z.infer<typeof seasonAveragesSchema>;

// Hit rates for betting lines
export const hitRatesSchema = z.record(z.string(), z.record(z.string(), z.number()));

export type HitRates = z.infer<typeof hitRatesSchema>;

// Vs team stats
export const vsTeamStatsSchema = z.object({
  games: z.number(),
  PTS: z.number(),
  REB: z.number(),
  AST: z.number(),
  PRA: z.number(),
  FG3M: z.number().optional(),
});

export type VsTeamStats = z.infer<typeof vsTeamStatsSchema>;

// Home/Away averages
export const splitAveragesSchema = z.object({
  PTS: z.number(),
  REB: z.number(),
  AST: z.number(),
  PRA: z.number(),
});

export type SplitAverages = z.infer<typeof splitAveragesSchema>;

// Complete player profile
export const playerSchema = z.object({
  player_id: z.number(),
  player_name: z.string(),
  team: z.string(),
  team_id: z.number().optional(),
  games_played: z.number().optional(),
  season_averages: seasonAveragesSchema,
  last_10_averages: seasonAveragesSchema.partial(),
  last_5_averages: seasonAveragesSchema.partial(),
  hit_rates: hitRatesSchema,
  vs_team: z.record(z.string(), vsTeamStatsSchema),
  recent_games: z.array(gameLogSchema),
  home_averages: splitAveragesSchema,
  away_averages: splitAveragesSchema,
});

export type Player = z.infer<typeof playerSchema>;

// Teammate impact data
export const teammateImpactSchema = z.object({
  name: z.string(),
  with: z.record(z.string(), z.number()),
  without: z.record(z.string(), z.number()),
  diff: z.record(z.string(), z.number()),
});

export type TeammateImpact = z.infer<typeof teammateImpactSchema>;

export const playerImpactSchema = z.object({
  games_missed: z.number(),
  teammates: z.array(teammateImpactSchema),
});

export type PlayerImpact = z.infer<typeof playerImpactSchema>;

// NBA Teams
export const NBA_TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
] as const;

export type NBATeam = typeof NBA_TEAMS[number];
