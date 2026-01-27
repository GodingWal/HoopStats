/**
 * Application constants and configuration values
 * Centralizes magic numbers and configuration for easier maintenance
 */

// ========================================
// BETTING CONFIGURATION
// ========================================

export const BETTING_CONFIG = {
  /** Maximum number of bets to display in the UI */
  MAX_BETS_DISPLAY: 50,

  /** Default number of days for track record */
  DEFAULT_TRACK_RECORD_DAYS: 30,

  /** Confidence thresholds based on hit rates */
  CONFIDENCE_THRESHOLDS: {
    HIGH_OVER: 70,    // Hit rate >= 70% for HIGH confidence OVER
    MEDIUM_OVER: 55,  // Hit rate >= 55% for MEDIUM confidence OVER
    HIGH_UNDER: 30,   // Hit rate <= 30% for HIGH confidence UNDER
    MEDIUM_UNDER: 45, // Hit rate <= 45% for MEDIUM confidence UNDER
  },

  /** Edge score thresholds */
  EDGE_THRESHOLDS: {
    STRONG: 5,       // Strong edge score
    GOOD: 3,         // Good edge score
    MIN_EDGE: 0.03,  // Minimum edge for recommendations (3%)
  },

  /** Hit rate thresholds for filtering */
  HIT_RATE_THRESHOLDS: {
    EXTREME_OVER: 78,   // Extreme over hit rate
    EXTREME_UNDER: 22,  // Extreme under hit rate
    STRONG_OVER: 75,    // Strong over hit rate
    STRONG_UNDER: 30,   // Strong under hit rate
  },

  /** Break-even probability for -110 odds */
  BREAK_EVEN_PROB: 0.524,
} as const;

// ========================================
// CACHE CONFIGURATION
// ========================================

export const CACHE_CONFIG = {
  /** Advanced stats cache duration (4 hours) */
  ADVANCED_STATS_TTL_MS: 4 * 60 * 60 * 1000,

  /** API cache duration (5 minutes) */
  API_CACHE_TTL_MS: 5 * 60 * 1000,

  /** Short cache duration (1 minute) */
  SHORT_CACHE_TTL_MS: 60 * 1000,

  /** Line watcher interval (30 seconds) */
  LINE_WATCHER_INTERVAL_MS: 30 * 1000,

  /** Default injury watcher interval (60 seconds) */
  INJURY_WATCHER_INTERVAL_MS: 60 * 1000,
} as const;

// ========================================
// API CONFIGURATION
// ========================================

export const API_CONFIG = {
  /** Default hours for recent line movements */
  DEFAULT_LINE_MOVEMENTS_HOURS: 24,

  /** Default limit for alerts */
  DEFAULT_ALERTS_LIMIT: 20,

  /** Default limit for team recent games */
  DEFAULT_TEAM_GAMES_LIMIT: 15,

  /** Minimum sample size for on/off splits */
  MIN_SPLIT_SAMPLE_SIZE: 3,

  /** Top beneficiaries limit */
  TOP_BENEFICIARIES_LIMIT: 5,
} as const;

// ========================================
// RATE LIMITING CONFIGURATION
// ========================================

export const RATE_LIMIT_CONFIG = {
  /** Rate limit window in milliseconds (15 minutes) */
  WINDOW_MS: 15 * 60 * 1000,

  /** Maximum requests per window */
  MAX_REQUESTS: 100,

  /** Maximum requests for expensive endpoints */
  MAX_EXPENSIVE_REQUESTS: 20,
} as const;

// ========================================
// STAT TYPE LABELS
// ========================================

export const STAT_LABELS: Record<string, string> = {
  PTS: "Points",
  REB: "Rebounds",
  AST: "Assists",
  PRA: "PTS+REB+AST",
  FG3M: "3-Pointers",
  FPTS: "Fantasy Score",
  STL: "Steals",
  BLK: "Blocks",
  TO: "Turnovers",
  PR: "PTS+REB",
  PA: "PTS+AST",
  RA: "REB+AST",
  MIN: "Minutes",
  FGA: "Field Goal Attempts",
} as const;

// ========================================
// VALID STAT TYPES
// ========================================

export const VALID_STAT_TYPES = [
  "PTS", "REB", "AST", "PRA", "FG3M", "FPTS",
  "STL", "BLK", "TO", "PR", "PA", "RA", "MIN", "FGA"
] as const;

export type StatType = typeof VALID_STAT_TYPES[number];

// ========================================
// TEAM ABBREVIATIONS
// ========================================

export const NBA_TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN",
  "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA",
  "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX",
  "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
] as const;

export type NbaTeam = typeof NBA_TEAMS[number];

// ========================================
// ERROR MESSAGES
// ========================================

export const ERROR_MESSAGES = {
  INVALID_PLAYER_ID: "Invalid player ID",
  PLAYER_NOT_FOUND: "Player not found",
  MISSING_REQUIRED_PARAMS: "Missing required parameters",
  INVALID_STAT_TYPE: "Invalid stat type",
  GAME_NOT_FOUND: "Game not found",
  TEAM_NOT_FOUND: "Team not found",
  NO_DATA_AVAILABLE: "No data available",
  INTERNAL_ERROR: "Internal server error",
  ODDS_API_NOT_CONFIGURED: "Odds API not configured",
} as const;
