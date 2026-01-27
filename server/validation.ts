/**
 * Input validation utilities for API routes
 * Provides consistent validation with proper error handling
 */

import { Request, Response, NextFunction } from "express";
import { z, ZodSchema, ZodError } from "zod";
import { VALID_STAT_TYPES, NBA_TEAMS, ERROR_MESSAGES } from "./constants";

// ========================================
// CUSTOM ERROR CLASS
// ========================================

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

// ========================================
// PRIMITIVE VALIDATORS
// ========================================

/**
 * Validates and parses a positive integer from a string
 */
export function validatePositiveInt(value: string | undefined, name: string): number {
  if (value === undefined || value === null || value === "") {
    throw new AppError(400, `${name} is required`);
  }

  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    throw new AppError(400, `${name} must be a valid integer`);
  }

  if (parsed <= 0) {
    throw new AppError(400, `${name} must be a positive integer`);
  }

  return parsed;
}

/**
 * Validates and parses an optional positive integer with a default value
 */
export function validateOptionalInt(
  value: string | undefined,
  defaultValue: number,
  name: string
): number {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    return defaultValue;
  }

  return parsed > 0 ? parsed : defaultValue;
}

/**
 * Validates and parses a positive float from a string
 */
export function validatePositiveFloat(value: string | undefined, name: string): number {
  if (value === undefined || value === null || value === "") {
    throw new AppError(400, `${name} is required`);
  }

  const parsed = parseFloat(value);

  if (isNaN(parsed)) {
    throw new AppError(400, `${name} must be a valid number`);
  }

  if (parsed <= 0) {
    throw new AppError(400, `${name} must be positive`);
  }

  return parsed;
}

/**
 * Validates and parses an optional float with a default value
 */
export function validateOptionalFloat(
  value: string | undefined,
  defaultValue: number,
  name: string
): number {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = parseFloat(value);

  return isNaN(parsed) ? defaultValue : parsed;
}

// ========================================
// STRING VALIDATORS
// ========================================

/**
 * Validates a non-empty string
 */
export function validateRequiredString(value: string | undefined, name: string): string {
  if (value === undefined || value === null || value.trim() === "") {
    throw new AppError(400, `${name} is required`);
  }
  return value.trim();
}

/**
 * Validates a stat type
 */
export function validateStatType(value: string | undefined, name: string = "stat"): string {
  const stat = validateRequiredString(value, name).toUpperCase();

  if (!VALID_STAT_TYPES.includes(stat as any)) {
    throw new AppError(400, `${name} must be one of: ${VALID_STAT_TYPES.join(", ")}`);
  }

  return stat;
}

/**
 * Validates an NBA team abbreviation
 */
export function validateTeamAbbr(value: string | undefined, name: string = "team"): string {
  const team = validateRequiredString(value, name).toUpperCase();

  if (!NBA_TEAMS.includes(team as any)) {
    throw new AppError(400, `${name} must be a valid NBA team abbreviation`);
  }

  return team;
}

/**
 * Validates a date string (YYYY-MM-DD or YYYYMMDD format)
 */
export function validateDateString(value: string | undefined, name: string = "date"): string {
  if (value === undefined || value === null || value === "") {
    throw new AppError(400, `${name} is required`);
  }

  // Accept both YYYY-MM-DD and YYYYMMDD formats
  const isoFormat = /^\d{4}-\d{2}-\d{2}$/;
  const shortFormat = /^\d{8}$/;

  if (!isoFormat.test(value) && !shortFormat.test(value)) {
    throw new AppError(400, `${name} must be in YYYY-MM-DD or YYYYMMDD format`);
  }

  // Validate it's a real date
  const date = new Date(value.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
  if (isNaN(date.getTime())) {
    throw new AppError(400, `${name} is not a valid date`);
  }

  return value;
}

// ========================================
// ZOD SCHEMA MIDDLEWARE
// ========================================

/**
 * Creates middleware that validates request body against a Zod schema
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        }));
        res.status(400).json({
          error: "Validation failed",
          details,
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Creates middleware that validates query parameters against a Zod schema
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        }));
        res.status(400).json({
          error: "Validation failed",
          details,
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Creates middleware that validates route params against a Zod schema
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        }));
        res.status(400).json({
          error: "Validation failed",
          details,
        });
        return;
      }
      next(error);
    }
  };
}

// ========================================
// COMMON ZOD SCHEMAS
// ========================================

export const playerIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "Player ID must be numeric"),
});

export const playerIdSchema = z.object({
  playerId: z.string().regex(/^\d+$/, "Player ID must be numeric"),
});

export const statQuerySchema = z.object({
  stat: z.string().min(1, "Stat type is required"),
  gameDate: z.string().optional(),
});

export const paginationSchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

export const betSchema = z.object({
  player_name: z.string().min(1, "Player name is required"),
  prop: z.string().min(1, "Prop type is required"),
  line: z.number().positive("Line must be positive"),
  side: z.enum(["over", "under"], { errorMap: () => ({ message: "Side must be 'over' or 'under'" }) }),
  season_average: z.number().optional(),
  last_5_average: z.number().optional(),
  hit_rate: z.number().min(0).max(100).optional(),
  opponent: z.string().optional(),
});

export const parlayLegsSchema = z.object({
  legs: z.array(z.object({
    playerId: z.number().int().positive(),
    stat: z.string().min(1),
    line: z.number().positive(),
    side: z.enum(["over", "under"]),
  })).min(1, "At least one leg is required"),
});

export const projectionsRequestSchema = z.object({
  players: z.array(z.string().min(1)).min(1, "At least one player is required"),
  includeInjuries: z.boolean().optional().default(true),
});

// ========================================
// ERROR HANDLER MIDDLEWARE
// ========================================

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.errors.map(e => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }

  // Log unexpected errors
  console.error("Unexpected error:", err);

  // Don't leak error details in production
  const message = process.env.NODE_ENV === "production"
    ? ERROR_MESSAGES.INTERNAL_ERROR
    : err.message;

  res.status(500).json({
    error: message,
  });
}

// ========================================
// ASYNC HANDLER WRAPPER
// ========================================

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Wraps async route handlers to catch errors and pass to error middleware
 */
export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
