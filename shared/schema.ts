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

// Advanced Stats
export const advancedStatsSchema = z.object({
  playerName: z.string(),
  usageRate: z.number(),
  tsPct: z.number(),
  astPct: z.number(),
  rebPct: z.number(),
  netRating: z.number(),
  pie: z.number(),
  gamesPlayed: z.number(),
});

export type AdvancedStats = z.infer<typeof advancedStatsSchema>;

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
  position: text("position"),
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
  edge_type: z.string().optional(),
  edge_score: z.number().optional(),
  edge_description: z.string().optional(),
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
  edge_type: text("edge_type"),
  edge_score: real("edge_score"),
  edge_description: text("edge_description"),
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

// ========================================
// BETTING LINES TRACKING
// ========================================

// Sportsbooks we track
export const sportsbooks = pgTable("sportsbooks", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 50 }).notNull().unique(), // 'fanduel', 'draftkings', etc.
  name: text("name").notNull(),
  active: boolean("active").default(true),
  lastSync: timestamp("last_sync"),
});

export const insertSportsbookSchema = createInsertSchema(sportsbooks).omit({ id: true });
export type InsertSportsbook = z.infer<typeof insertSportsbookSchema>;
export type DbSportsbook = typeof sportsbooks.$inferSelect;

// Player prop lines from sportsbooks
export const playerPropLines = pgTable("player_prop_lines", {
  id: serial("id").primaryKey(),

  // Player & game info
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  gameId: varchar("game_id", { length: 20 }).notNull(),
  gameDate: date("game_date").notNull(),
  opponent: text("opponent").notNull(),

  // Prop details
  stat: varchar("stat", { length: 20 }).notNull(), // 'points', 'rebounds', 'assists', etc.
  line: real("line").notNull(),

  // Sportsbook & odds
  sportsbookId: integer("sportsbook_id").references(() => sportsbooks.id).notNull(),
  sportsbookKey: varchar("sportsbook_key", { length: 50 }).notNull(),

  // Over/Under odds
  overOdds: integer("over_odds").notNull(), // American odds format (-110, +105, etc.)
  underOdds: integer("under_odds").notNull(),

  // Implied probabilities (calculated from odds)
  overProb: real("over_prob").notNull(),
  underProb: real("under_prob").notNull(),

  // Vig calculation
  totalProb: real("total_prob").notNull(), // over_prob + under_prob (should be >1, difference is vig)
  vig: real("vig").notNull(), // (total_prob - 1) / 2

  // Metadata
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true), // False if line is removed/suspended
});

export const insertPlayerPropLineSchema = createInsertSchema(playerPropLines).omit({ id: true, capturedAt: true });
export type InsertPlayerPropLine = z.infer<typeof insertPlayerPropLineSchema>;
export type DbPlayerPropLine = typeof playerPropLines.$inferSelect;

// Line movement tracking (denormalized for quick queries)
export const lineMovements = pgTable("line_movements", {
  id: serial("id").primaryKey(),

  // Reference to the player/game/stat
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  gameId: varchar("game_id", { length: 20 }).notNull(),
  stat: varchar("stat", { length: 20 }).notNull(),
  sportsbookKey: varchar("sportsbook_key", { length: 50 }).notNull(),

  // Line movement
  oldLine: real("old_line").notNull(),
  newLine: real("new_line").notNull(),
  lineChange: real("line_change").notNull(), // newLine - oldLine

  // Odds movement
  oldOverOdds: integer("old_over_odds").notNull(),
  newOverOdds: integer("new_over_odds").notNull(),
  oldUnderOdds: integer("old_under_odds").notNull(),
  newUnderOdds: integer("new_under_odds").notNull(),

  // Movement metadata
  direction: varchar("direction", { length: 10 }).notNull(), // 'up', 'down', 'odds_only'
  magnitude: real("magnitude").notNull(), // Absolute value of line change
  isSignificant: boolean("is_significant").notNull(), // True if movement >= 0.5 or odds shift >= 20

  // Timestamps
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  gameDate: date("game_date").notNull(),
});

export const insertLineMovementSchema = createInsertSchema(lineMovements).omit({ id: true, detectedAt: true });
export type InsertLineMovement = z.infer<typeof insertLineMovementSchema>;
export type DbLineMovement = typeof lineMovements.$inferSelect;

// Best available lines (aggregated view)
export const bestLines = pgTable("best_lines", {
  id: serial("id").primaryKey(),

  // Player & game info
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  gameId: varchar("game_id", { length: 20 }).notNull(),
  gameDate: date("game_date").notNull(),
  stat: varchar("stat", { length: 20 }).notNull(),

  // Best over line
  bestOverLine: real("best_over_line"),
  bestOverOdds: integer("best_over_odds"),
  bestOverBook: varchar("best_over_book", { length: 50 }),

  // Best under line
  bestUnderLine: real("best_under_line"),
  bestUnderOdds: integer("best_under_odds"),
  bestUnderBook: varchar("best_under_book", { length: 50 }),

  // Market consensus
  consensusLine: real("consensus_line"), // Average across all books
  numBooks: integer("num_books").notNull(), // How many books have this prop
  lineSpread: real("line_spread"), // Max line - min line

  // Last updated
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

export const insertBestLineSchema = createInsertSchema(bestLines).omit({ id: true, lastUpdated: true });
export type InsertBestLine = z.infer<typeof insertBestLineSchema>;
export type DbBestLine = typeof bestLines.$inferSelect;

// User bet tracking
export const userBets = pgTable("user_bets", {
  id: serial("id").primaryKey(),

  // Bet details
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  gameId: varchar("game_id", { length: 20 }).notNull(),
  gameDate: date("game_date").notNull(),

  stat: varchar("stat", { length: 20 }).notNull(),
  line: real("line").notNull(),
  side: varchar("side", { length: 10 }).notNull(), // 'over' or 'under'

  // Bet placement
  sportsbookKey: varchar("sportsbook_key", { length: 50 }).notNull(),
  odds: integer("odds").notNull(),
  stake: real("stake").notNull(), // Amount wagered (in units)

  // Outcome
  result: varchar("result", { length: 10 }), // 'win', 'loss', 'push', 'pending'
  actualValue: real("actual_value"), // Player's actual stat value
  profit: real("profit"), // Net profit/loss in units

  // Edge tracking
  projectedProb: real("projected_prob"), // Our model's probability
  impliedProb: real("implied_prob"), // Odds implied probability
  edge: real("edge"), // projectedProb - impliedProb

  // Metadata
  placedAt: timestamp("placed_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  notes: text("notes"),
});

export const insertUserBetSchema = createInsertSchema(userBets).omit({ id: true, placedAt: true });
export type InsertUserBet = z.infer<typeof insertUserBetSchema>;
export type DbUserBet = typeof userBets.$inferSelect;

// Parlay tracking (for PrizePicks flex plays)
export const parlays = pgTable("parlays", {
  id: serial("id").primaryKey(),

  // Parlay details
  parlayType: varchar("parlay_type", { length: 20 }).notNull(), // 'flex' or 'power'
  numPicks: integer("num_picks").notNull(),
  entryAmount: real("entry_amount").notNull(),
  payoutMultiplier: real("payout_multiplier").notNull(), // 3x, 5x, 10x, 20x, 25x, etc.

  // Outcome
  result: varchar("result", { length: 10 }), // 'win', 'loss', 'push', 'pending'
  profit: real("profit"), // Net profit/loss

  // Metadata
  placedAt: timestamp("placed_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  notes: text("notes"),
});

export const insertParlaySchema = createInsertSchema(parlays).omit({ id: true, placedAt: true });
export type InsertParlay = z.infer<typeof insertParlaySchema>;
export type DbParlay = typeof parlays.$inferSelect;

// Individual picks within a parlay
export const parlayPicks = pgTable("parlay_picks", {
  id: serial("id").primaryKey(),

  // Reference to parlay
  parlayId: integer("parlay_id").references(() => parlays.id, { onDelete: 'cascade' }).notNull(),

  // Pick details
  playerId: integer("player_id"),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  stat: varchar("stat", { length: 20 }).notNull(),
  line: real("line").notNull(),
  side: varchar("side", { length: 10 }).notNull(), // 'over' or 'under'
  gameDate: date("game_date").notNull(),

  // Outcome
  result: varchar("result", { length: 10 }), // 'hit', 'miss', 'push', 'pending'
  actualValue: real("actual_value"), // Player's actual stat value
});

export const insertParlayPickSchema = createInsertSchema(parlayPicks).omit({ id: true });
export type InsertParlayPick = z.infer<typeof insertParlayPickSchema>;
export type DbParlayPick = typeof parlayPicks.$inferSelect;

// Line alert configurations
export const lineAlerts = pgTable("line_alerts", {
  id: serial("id").primaryKey(),

  // Alert criteria
  playerId: integer("player_id"),
  playerName: text("player_name"),
  stat: varchar("stat", { length: 20 }),

  // Trigger conditions
  triggerType: varchar("trigger_type", { length: 20 }).notNull(), // 'line_move', 'odds_change', 'edge_threshold'
  threshold: real("threshold").notNull(), // e.g., 0.5 for line movement, 0.05 for edge

  // Alert settings
  enabled: boolean("enabled").default(true),
  sportsbookKeys: jsonb("sportsbook_keys").$type<string[]>(), // null = all books

  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastTriggered: timestamp("last_triggered"),
  triggerCount: integer("trigger_count").default(0),
});

export const insertLineAlertSchema = createInsertSchema(lineAlerts).omit({ id: true, createdAt: true });
export type InsertLineAlert = z.infer<typeof insertLineAlertSchema>;
export type DbLineAlert = typeof lineAlerts.$inferSelect;

// Validation schemas
export const lineDataSchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  gameId: z.string(),
  gameDate: z.string(),
  stat: z.string(),
  lines: z.array(z.object({
    sportsbookKey: z.string(),
    sportsbookName: z.string(),
    line: z.number(),
    overOdds: z.number(),
    underOdds: z.number(),
    capturedAt: z.string(),
  })),
});

export type LineData = z.infer<typeof lineDataSchema>;

export const lineComparisonSchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  stat: z.string(),
  gameDate: z.string(),
  lines: z.array(z.object({
    sportsbook: z.string(),
    line: z.number(),
    overOdds: z.number(),
    underOdds: z.number(),
    overImpliedProb: z.number(),
    underImpliedProb: z.number(),
    vig: z.number(),
  })),
  bestOver: z.object({
    sportsbook: z.string(),
    line: z.number(),
    odds: z.number(),
  }),
  bestUnder: z.object({
    sportsbook: z.string(),
    line: z.number(),
    odds: z.number(),
  }),
  consensus: z.object({
    line: z.number(),
    spread: z.number(),
  }),
});

export type LineComparison = z.infer<typeof lineComparisonSchema>;

// ========================================
// INJURY TRACKING TABLES
// ========================================

// Injury status enum
export const InjuryStatus = ['out', 'doubtful', 'questionable', 'probable', 'available', 'day-to-day', 'suspended'] as const;
export type InjuryStatusType = typeof InjuryStatus[number];

// Current player injuries (real-time state)
export const playerInjuries = pgTable("player_injuries", {
  id: serial("id").primaryKey(),

  // Player identification
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  teamId: integer("team_id"),

  // Injury details
  status: varchar("status", { length: 20 }).notNull(), // 'out', 'doubtful', 'questionable', 'probable', 'available'
  injuryType: text("injury_type"), // e.g., 'Knee', 'Ankle', 'Illness', 'Rest'
  description: text("description"), // e.g., 'Left knee soreness'
  returnDate: date("return_date"), // Expected return (if known)

  // Source tracking
  source: varchar("source", { length: 50 }).notNull(), // 'espn', 'rotowire', 'twitter', 'team_official'
  sourceUrl: text("source_url"),

  // Timestamps
  firstReported: timestamp("first_reported").defaultNow().notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  statusChangedAt: timestamp("status_changed_at").defaultNow().notNull(),

  // Active flag (false when player returns)
  isActive: boolean("is_active").default(true),
});

export const insertPlayerInjurySchema = createInsertSchema(playerInjuries).omit({ id: true, firstReported: true, lastUpdated: true });
export type InsertPlayerInjury = z.infer<typeof insertPlayerInjurySchema>;
export type DbPlayerInjury = typeof playerInjuries.$inferSelect;

// Injury status change history (for tracking when status changed)
export const injuryHistory = pgTable("injury_history", {
  id: serial("id").primaryKey(),

  // Reference to player
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),

  // Status change
  previousStatus: varchar("previous_status", { length: 20 }),
  newStatus: varchar("new_status", { length: 20 }).notNull(),
  injuryType: text("injury_type"),
  description: text("description"),

  // Source
  source: varchar("source", { length: 50 }).notNull(),

  // When detected
  detectedAt: timestamp("detected_at").defaultNow().notNull(),

  // Was this change significant for betting (status -> out or out -> available)
  isSignificant: boolean("is_significant").default(false),
});

export const insertInjuryHistorySchema = createInsertSchema(injuryHistory).omit({ id: true, detectedAt: true });
export type InsertInjuryHistory = z.infer<typeof insertInjuryHistorySchema>;
export type DbInjuryHistory = typeof injuryHistory.$inferSelect;

// Injury impact on teammates (calculated projection changes)
export const injuryImpacts = pgTable("injury_impacts", {
  id: serial("id").primaryKey(),

  // Injured player
  injuredPlayerId: integer("injured_player_id").notNull(),
  injuredPlayerName: text("injured_player_name").notNull(),
  injuredPlayerTeam: text("injured_player_team").notNull(),

  // Benefiting player
  beneficiaryPlayerId: integer("beneficiary_player_id").notNull(),
  beneficiaryPlayerName: text("beneficiary_player_name").notNull(),

  // Game context
  gameId: varchar("game_id", { length: 20 }),
  gameDate: date("game_date").notNull(),
  opponent: text("opponent"),

  // Projection changes (before/after injury factored in)
  stat: varchar("stat", { length: 20 }).notNull(),
  baselineMean: real("baseline_mean").notNull(),
  adjustedMean: real("adjusted_mean").notNull(),
  baselineStd: real("baseline_std").notNull(),
  adjustedStd: real("adjusted_std").notNull(),

  // Edge changes
  currentLine: real("current_line"),
  baselineProbOver: real("baseline_prob_over"),
  adjustedProbOver: real("adjusted_prob_over"),
  edgeChange: real("edge_change"), // Change in edge due to injury

  // Is this a betting opportunity?
  isOpportunity: boolean("is_opportunity").default(false), // True if edge change > threshold

  // Timestamps
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
});

export const insertInjuryImpactSchema = createInsertSchema(injuryImpacts).omit({ id: true, calculatedAt: true });
export type InsertInjuryImpact = z.infer<typeof insertInjuryImpactSchema>;
export type DbInjuryImpact = typeof injuryImpacts.$inferSelect;

// Injury alert schema (for real-time notifications)
export const injuryAlertSchema = z.object({
  injuredPlayer: z.object({
    playerId: z.number(),
    playerName: z.string(),
    team: z.string(),
    status: z.enum(['out', 'doubtful', 'questionable', 'probable', 'available', 'day-to-day', 'suspended']),
    previousStatus: z.string().optional(),
    injuryType: z.string().optional(),
    description: z.string().optional(),
    source: z.string(),
  }),
  affectedPlayers: z.array(z.object({
    playerId: z.number(),
    playerName: z.string(),
    team: z.string(),
    impacts: z.array(z.object({
      stat: z.string(),
      baselineMean: z.number(),
      adjustedMean: z.number(),
      change: z.number(), // Absolute change in projection
      changePercent: z.number(), // Percentage change
      currentLine: z.number().optional(),
      edgeBefore: z.number().optional(),
      edgeAfter: z.number().optional(),
      isOpportunity: z.boolean(),
    })),
  })),
  timestamp: z.string(),
  isSignificant: z.boolean(),
});

export type InjuryAlertData = z.infer<typeof injuryAlertSchema>;

// Player on/off splits (teammate performance with/without injured player)
export const playerOnOffSplits = pgTable("player_on_off_splits", {
  id: serial("id").primaryKey(),

  // Player being analyzed (teammate who benefits/suffers)
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  team: varchar("team", { length: 10 }).notNull(),

  // Star player who was OUT
  withoutPlayerId: integer("without_player_id").notNull(),
  withoutPlayerName: text("without_player_name").notNull(),

  season: varchar("season", { length: 10 }).notNull(), // e.g., "2024-25"

  // Sample sizes
  gamesWithTeammate: integer("games_with_teammate").notNull(),
  gamesWithoutTeammate: integer("games_without_teammate").notNull(),

  // Stats WITH teammate
  ptsWithTeammate: real("pts_with_teammate"),
  rebWithTeammate: real("reb_with_teammate"),
  astWithTeammate: real("ast_with_teammate"),
  minWithTeammate: real("min_with_teammate"),
  fgaWithTeammate: real("fga_with_teammate"),

  // Stats WITHOUT teammate
  ptsWithoutTeammate: real("pts_without_teammate"),
  rebWithoutTeammate: real("reb_without_teammate"),
  astWithoutTeammate: real("ast_without_teammate"),
  minWithoutTeammate: real("min_without_teammate"),
  fgaWithoutTeammate: real("fga_without_teammate"),

  // Deltas (precomputed)
  ptsDelta: real("pts_delta"),
  rebDelta: real("reb_delta"),
  astDelta: real("ast_delta"),
  minDelta: real("min_delta"),
  fgaDelta: real("fga_delta"),

  // Metadata
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlayerOnOffSplitSchema = createInsertSchema(playerOnOffSplits).omit({ id: true, calculatedAt: true, updatedAt: true });
export type InsertPlayerOnOffSplit = z.infer<typeof insertPlayerOnOffSplitSchema>;
export type DbPlayerOnOffSplit = typeof playerOnOffSplits.$inferSelect;

// ========================================
// TEAM STATS SCHEMAS
// ========================================

// Quarter/Half scoring breakdown
export const quarterScoringSchema = z.object({
  q1: z.number(),
  q2: z.number(),
  q3: z.number(),
  q4: z.number(),
  ot: z.number().optional(),
  firstHalf: z.number(),
  secondHalf: z.number(),
});

export type QuarterScoring = z.infer<typeof quarterScoringSchema>;

// Game context for rotation analysis
export const gameContextSchema = z.object({
  gameId: z.string(),
  date: z.string(),
  opponent: z.string(),
  isHome: z.boolean(),
  result: z.enum(['W', 'L']),
  finalScore: z.string(),
  pointDifferential: z.number(),
  gameType: z.enum(['blowout_win', 'close_win', 'close_loss', 'blowout_loss']), // +/- 10 pts threshold
  quarterScoring: quarterScoringSchema,
  stats: z.object({
    rebounds: z.number().optional(),
    assists: z.number().optional(),
    steals: z.number().optional(),
    blocks: z.number().optional(),
    turnovers: z.number().optional(),
    fgPct: z.number().optional(),
    fg3Pct: z.number().optional(),
    ftPct: z.number().optional(),
  }).optional(),
});

export type GameContext = z.infer<typeof gameContextSchema>;

// Player rotation stats by game type
export const playerRotationStatsSchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  position: z.string().optional(),
  // Overall averages
  overallMpg: z.number(),
  overallPpg: z.number(),
  overallRpg: z.number(),
  overallApg: z.number(),
  gamesPlayed: z.number(),
  // Close games (within 10 points)
  closeGameMpg: z.number(),
  closeGamePpg: z.number(),
  closeGamesPlayed: z.number(),
  // Blowout games (more than 10 points)
  blowoutMpg: z.number(),
  blowoutPpg: z.number(),
  blowoutGamesPlayed: z.number(),
  // Starter vs bench indicator
  isStarter: z.boolean(),
  starterPct: z.number(), // % of games started
});

export type PlayerRotationStats = z.infer<typeof playerRotationStatsSchema>;

// Team advanced stats
export const teamAdvancedStatsSchema = z.object({
  // Offensive
  offRating: z.number(), // Points per 100 possessions
  pace: z.number(), // Possessions per game
  efgPct: z.number(), // Effective FG%
  tsPct: z.number(), // True Shooting %
  tovPct: z.number(), // Turnover %
  orbPct: z.number(), // Offensive Rebound %
  ftRate: z.number(), // Free Throw Rate
  // Defensive
  defRating: z.number(), // Opponent points per 100 possessions
  oppEfgPct: z.number(), // Opponent eFG%
  drbPct: z.number(), // Defensive Rebound %
  stlPct: z.number(), // Steal %
  blkPct: z.number(), // Block %
  // Net
  netRating: z.number(), // Off rating - def rating
  // Four Factors
  fourFactorsOff: z.object({
    efgPct: z.number(),
    tovPct: z.number(),
    orbPct: z.number(),
    ftRate: z.number(),
  }),
  fourFactorsDef: z.object({
    efgPct: z.number(),
    tovPct: z.number(),
    drbPct: z.number(),
    ftRate: z.number(),
  }),
});

export type TeamAdvancedStats = z.infer<typeof teamAdvancedStatsSchema>;

// Team basic stats
export const teamBasicStatsSchema = z.object({
  gamesPlayed: z.number(),
  wins: z.number(),
  losses: z.number(),
  winPct: z.number(),
  ppg: z.number(), // Points per game
  oppPpg: z.number(), // Opponent points per game
  rpg: z.number(), // Rebounds per game
  apg: z.number(), // Assists per game
  spg: z.number(), // Steals per game
  bpg: z.number(), // Blocks per game
  tpg: z.number(), // Turnovers per game
  fgPct: z.number(),
  fg3Pct: z.number(),
  ftPct: z.number(),
  // Home/Away splits
  homeRecord: z.string(), // "15-5"
  awayRecord: z.string(), // "12-8"
  homePpg: z.number(),
  awayPpg: z.number(),
  // Scoring by quarter
  avgQuarterScoring: quarterScoringSchema,
  oppAvgQuarterScoring: quarterScoringSchema,
});

export type TeamBasicStats = z.infer<typeof teamBasicStatsSchema>;

// Complete team stats response
export const teamStatsSchema = z.object({
  teamId: z.number(),
  teamAbbr: z.string(),
  teamName: z.string(),
  teamLogo: z.string().optional(),
  teamColor: z.string().optional(),
  conference: z.string().optional(),
  division: z.string().optional(),
  // Stats
  basicStats: teamBasicStatsSchema,
  advancedStats: teamAdvancedStatsSchema.optional(),
  // Rotation & minutes
  rotation: z.array(playerRotationStatsSchema),
  // Recent games with quarter breakdown
  recentGames: z.array(gameContextSchema),
  // Streak info
  streak: z.object({
    type: z.enum(['W', 'L']),
    count: z.number(),
  }).optional(),
  // Last 10 games record
  last10: z.string().optional(),
});

export type TeamStats = z.infer<typeof teamStatsSchema>;

// Team comparison schema
export const teamComparisonSchema = z.object({
  team1: teamStatsSchema,
  team2: teamStatsSchema,
  headToHead: z.object({
    team1Wins: z.number(),
    team2Wins: z.number(),
    avgPointDiff: z.number(),
    recentGames: z.array(z.object({
      date: z.string(),
      winner: z.string(),
      score: z.string(),
    })),
  }).optional(),
});

export type TeamComparison = z.infer<typeof teamComparisonSchema>;

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull(), // 'EDGE', 'INJURY', 'SYSTEM'
  severity: text("severity").default("INFO"), // 'INFO', 'HIGH', 'CRITICAL'
  created_at: timestamp("created_at").defaultNow(),
  read: boolean("read").default(false),
  metadata: jsonb("metadata"), // Store bet info or player info
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// ========================================
// PRIZEPICKS LINE HISTORY TRACKING
// ========================================

// Store every PrizePicks line snapshot for historical analysis
export const prizePicksLines = pgTable("prizepicks_lines", {
  id: serial("id").primaryKey(),

  // PrizePicks-specific IDs
  prizePicksId: varchar("prizepicks_id", { length: 50 }).notNull(), // PrizePicks projection ID
  prizePicksPlayerId: varchar("prizepicks_player_id", { length: 50 }).notNull(),

  // Player info
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  teamAbbr: varchar("team_abbr", { length: 10 }),
  position: varchar("position", { length: 10 }),

  // Game info
  gameTime: timestamp("game_time").notNull(),
  opponent: text("opponent"),

  // Line details
  statType: varchar("stat_type", { length: 50 }).notNull(), // 'Points', 'Rebounds', etc.
  statTypeAbbr: varchar("stat_type_abbr", { length: 10 }), // 'PTS', 'REB', etc.
  line: real("line").notNull(),

  // Player image (for UI)
  imageUrl: text("image_url"),

  // Metadata
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true), // False once game starts/completes
});

export const insertPrizePicksLineSchema = createInsertSchema(prizePicksLines).omit({ id: true, capturedAt: true });
export type InsertPrizePicksLine = z.infer<typeof insertPrizePicksLineSchema>;
export type DbPrizePicksLine = typeof prizePicksLines.$inferSelect;

// Track line movements specifically for PrizePicks
export const prizePicksLineMovements = pgTable("prizepicks_line_movements", {
  id: serial("id").primaryKey(),

  // Reference to player/stat
  prizePicksPlayerId: varchar("prizepicks_player_id", { length: 50 }).notNull(),
  playerName: text("player_name").notNull(),
  statType: varchar("stat_type", { length: 50 }).notNull(),
  statTypeAbbr: varchar("stat_type_abbr", { length: 10 }),

  // Game context
  gameTime: timestamp("game_time").notNull(),
  opponent: text("opponent"),

  // Line movement
  oldLine: real("old_line").notNull(),
  newLine: real("new_line").notNull(),
  lineChange: real("line_change").notNull(), // newLine - oldLine

  // Movement metadata
  direction: varchar("direction", { length: 10 }).notNull(), // 'up' or 'down'
  magnitude: real("magnitude").notNull(), // Absolute value of line change
  isSignificant: boolean("is_significant").notNull(), // True if movement >= 0.5

  // Timestamps
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
});

export const insertPrizePicksLineMovementSchema = createInsertSchema(prizePicksLineMovements).omit({ id: true, detectedAt: true });
export type InsertPrizePicksLineMovement = z.infer<typeof insertPrizePicksLineMovementSchema>;
export type DbPrizePicksLineMovement = typeof prizePicksLineMovements.$inferSelect;

// Aggregated daily line history for quick analysis
export const prizePicksDailyLines = pgTable("prizepicks_daily_lines", {
  id: serial("id").primaryKey(),

  // Player/stat identification
  prizePicksPlayerId: varchar("prizepicks_player_id", { length: 50 }).notNull(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  statType: varchar("stat_type", { length: 50 }).notNull(),
  statTypeAbbr: varchar("stat_type_abbr", { length: 10 }),

  // Date and game info
  gameDate: date("game_date").notNull(),
  gameTime: timestamp("game_time").notNull(),
  opponent: text("opponent"),

  // Opening and closing lines
  openingLine: real("opening_line").notNull(), // First captured line of the day
  closingLine: real("closing_line"), // Last captured line before game
  openingCapturedAt: timestamp("opening_captured_at").notNull(),
  closingCapturedAt: timestamp("closing_captured_at"),

  // Line movement summary
  totalMovement: real("total_movement").default(0), // Sum of all line changes
  netMovement: real("net_movement").default(0), // closingLine - openingLine
  numMovements: integer("num_movements").default(0), // Count of line changes
  highLine: real("high_line"), // Highest line seen
  lowLine: real("low_line"), // Lowest line seen

  // Outcome (filled after game)
  actualValue: real("actual_value"),
  hitOver: boolean("hit_over"),

  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPrizePicksDailyLineSchema = createInsertSchema(prizePicksDailyLines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPrizePicksDailyLine = z.infer<typeof insertPrizePicksDailyLineSchema>;
export type DbPrizePicksDailyLine = typeof prizePicksDailyLines.$inferSelect;

// PrizePicks line history query schemas
export const prizePicksLineHistorySchema = z.object({
  playerId: z.string(),
  playerName: z.string(),
  statType: z.string(),
  gameTime: z.string(),
  opponent: z.string().optional(),
  lines: z.array(z.object({
    line: z.number(),
    capturedAt: z.string(),
  })),
  openingLine: z.number(),
  currentLine: z.number(),
  netMovement: z.number(),
  movements: z.array(z.object({
    oldLine: z.number(),
    newLine: z.number(),
    change: z.number(),
    direction: z.string(),
    detectedAt: z.string(),
  })),
});

export type PrizePicksLineHistory = z.infer<typeof prizePicksLineHistorySchema>;
