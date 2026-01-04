import { z } from "zod";
import { pgTable, serial, text, integer, real, jsonb, timestamp, date, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

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

// Complete player profile (Zod schema for validation)
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

// Drizzle database table for players
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  player_id: integer("player_id").notNull().unique(),
  player_name: text("player_name").notNull(),
  team: text("team").notNull(),
  team_id: integer("team_id"),
  games_played: integer("games_played"),
  season_averages: jsonb("season_averages").notNull().$type<SeasonAverages>(),
  last_10_averages: jsonb("last_10_averages").notNull().$type<Partial<SeasonAverages>>(),
  last_5_averages: jsonb("last_5_averages").notNull().$type<Partial<SeasonAverages>>(),
  hit_rates: jsonb("hit_rates").notNull().$type<HitRates>(),
  vs_team: jsonb("vs_team").notNull().$type<Record<string, VsTeamStats>>(),
  recent_games: jsonb("recent_games").notNull().$type<GameLog[]>(),
  home_averages: jsonb("home_averages").notNull().$type<SplitAverages>(),
  away_averages: jsonb("away_averages").notNull().$type<SplitAverages>(),
});

export const insertPlayerSchema = createInsertSchema(players, {
  season_averages: seasonAveragesSchema,
  last_10_averages: seasonAveragesSchema.partial(),
  last_5_averages: seasonAveragesSchema.partial(),
  hit_rates: hitRatesSchema,
  vs_team: z.record(z.string(), vsTeamStatsSchema),
  recent_games: z.array(gameLogSchema),
  home_averages: splitAveragesSchema,
  away_averages: splitAveragesSchema,
}).omit({ id: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type DbPlayer = typeof players.$inferSelect;

// Potential bet schema
export const potentialBetSchema = z.object({
  id: z.number().optional(),
  player_id: z.number(),
  player_name: z.string(),
  team: z.string(),
  stat_type: z.string(),
  line: z.number(),
  hit_rate: z.number(),
  season_avg: z.number(),
  last_5_avg: z.number().optional(),
  recommendation: z.enum(["OVER", "UNDER"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export type PotentialBet = z.infer<typeof potentialBetSchema>;

// Drizzle table for potential bets
export const potentialBets = pgTable("potential_bets", {
  id: serial("id").primaryKey(),
  player_id: integer("player_id").notNull(),
  player_name: text("player_name").notNull(),
  team: text("team").notNull(),
  stat_type: text("stat_type").notNull(),
  line: real("line").notNull(),
  hit_rate: real("hit_rate").notNull(),
  season_avg: real("season_avg").notNull(),
  last_5_avg: real("last_5_avg"),
  recommendation: text("recommendation").notNull(),
  confidence: text("confidence").notNull(),
});

export const insertPotentialBetSchema = createInsertSchema(potentialBets).omit({ id: true });
export type InsertPotentialBet = z.infer<typeof insertPotentialBetSchema>;
export type DbPotentialBet = typeof potentialBets.$inferSelect;

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

// ========================================
// ANALYTICS & PROJECTIONS TABLES
// ========================================

// Track projections vs actuals (builds track record)
export const projections = pgTable("projections", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  gameId: varchar("game_id", { length: 20 }).notNull(),
  stat: varchar("stat", { length: 20 }).notNull(), // 'points', 'rebounds', 'assists', etc.

  // Projection data
  projectedMean: real("projected_mean").notNull(),
  projectedStd: real("projected_std").notNull(),
  probOver: real("prob_over").notNull(),
  line: real("line").notNull(),

  // Actuals (filled after game)
  actualValue: real("actual_value"),
  hit: boolean("hit"),

  // Metadata
  createdAt: timestamp("created_at").defaultNow(),
  gameDate: date("game_date").notNull(),
});

export const insertProjectionSchema = createInsertSchema(projections).omit({ id: true, createdAt: true });
export type InsertProjection = z.infer<typeof insertProjectionSchema>;
export type DbProjection = typeof projections.$inferSelect;

// Track betting recommendations
export const recommendations = pgTable("recommendations", {
  id: serial("id").primaryKey(),
  projectionId: integer("projection_id").references(() => projections.id),
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  stat: varchar("stat", { length: 20 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(), // 'over' or 'under'
  line: real("line").notNull(),
  edge: real("edge").notNull(),
  confidence: varchar("confidence", { length: 10 }).notNull(), // 'high', 'medium', 'low'
  recommendedBetSize: real("recommended_bet_size"),

  // Track if user followed
  userBet: boolean("user_bet").default(false),
  profit: real("profit"),

  // Metadata
  createdAt: timestamp("created_at").defaultNow(),
  gameDate: date("game_date").notNull(),
});

export const insertRecommendationSchema = createInsertSchema(recommendations).omit({ id: true, createdAt: true });
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type DbRecommendation = typeof recommendations.$inferSelect;

// Opponent defensive ratings (cache these)
export const teamDefense = pgTable("team_defense", {
  teamId: integer("team_id").primaryKey(),
  teamAbbr: varchar("team_abbr", { length: 3 }).notNull(),
  season: varchar("season", { length: 10 }).notNull(),
  defRating: real("def_rating"),
  pace: real("pace"),
  oppPtsAllowed: real("opp_pts_allowed"),
  oppRebAllowed: real("opp_reb_allowed"),
  oppAstAllowed: real("opp_ast_allowed"),
  opp3PtPctAllowed: real("opp_3pt_pct_allowed"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTeamDefenseSchema = createInsertSchema(teamDefense).omit({ updatedAt: true });
export type InsertTeamDefense = z.infer<typeof insertTeamDefenseSchema>;
export type DbTeamDefense = typeof teamDefense.$inferSelect;

// Prop evaluation request/response schemas
export const propEvaluationSchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  stat: z.string(),
  line: z.number(),

  // Projection data
  projectedMean: z.number(),
  projectedStd: z.number(),

  // Probabilities
  probOver: z.number(),
  probUnder: z.number(),

  // Betting signal
  edge: z.number(),
  recommendedSide: z.enum(['over', 'under', 'no_bet']),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type PropEvaluation = z.infer<typeof propEvaluationSchema>;

// Parlay leg schema
export const parlayLegSchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  stat: z.string(),
  line: z.number(),
  side: z.enum(['over', 'under']),
});

export type ParlayLeg = z.infer<typeof parlayLegSchema>;

// Track record summary schema
export const trackRecordSchema = z.object({
  total: z.number(),
  wins: z.number(),
  losses: z.number(),
  hitRate: z.number(),
  roi: z.number(),
  profit: z.number(),
  byConfidence: z.object({
    high: z.object({ wins: z.number(), total: z.number(), hitRate: z.number() }),
    medium: z.object({ wins: z.number(), total: z.number(), hitRate: z.number() }),
    low: z.object({ wins: z.number(), total: z.number(), hitRate: z.number() }),
  }),
  byStat: z.record(z.string(), z.object({ wins: z.number(), total: z.number(), hitRate: z.number() })),
  equityCurve: z.array(z.object({ date: z.string(), profit: z.number() })),
  calibration: z.array(z.object({ predicted: z.number(), actual: z.number(), count: z.number() })),
});

export type TrackRecord = z.infer<typeof trackRecordSchema>;
