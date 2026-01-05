import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';
import { AppError } from './errorHandler';

export function validateRequest(schema: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }

      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query);
      }

      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Common validation schemas
export const schemas = {
  playerId: z.object({
    id: z.string().regex(/^\d+$/, 'Player ID must be a number').transform(Number)
  }),

  gameId: z.object({
    gameId: z.string().min(1, 'Game ID is required')
  }),

  teamId: z.object({
    teamId: z.string().min(1, 'Team ID is required')
  }),

  searchQuery: z.object({
    q: z.string().min(1, 'Search query is required')
  }),

  dateQuery: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional()
  }),

  userBet: z.object({
    player_id: z.number().positive('Player ID must be a positive number'),
    player_name: z.string().min(1, 'Player name is required'),
    team: z.string().min(1, 'Team is required'),
    stat_type: z.enum(['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'PRA', 'PR', 'PA', 'RA']),
    line: z.number().positive('Line must be a positive number'),
    position: z.enum(['OVER', 'UNDER']),
    odds: z.number(),
    stake: z.number().positive('Stake must be a positive number').optional(),
    sportsbook: z.string().optional(),
    game_date: z.string().optional(),
    notes: z.string().optional()
  }),

  projectionRequest: z.object({
    playerId: z.number().positive(),
    opponent: z.string().min(1),
    location: z.enum(['home', 'away']),
    injuries: z.array(z.number()).optional()
  }),

  parlayRequest: z.object({
    legs: z.array(z.object({
      playerId: z.number().positive(),
      stat: z.string(),
      line: z.number(),
      position: z.enum(['OVER', 'UNDER'])
    })).min(2, 'Parlay must have at least 2 legs')
  })
};

export function validatePositiveInt(value: string, name: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new AppError(400, `${name} must be a positive integer`);
  }
  return parsed;
}

export function validateDateString(value: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(value)) {
    throw new AppError(400, 'Date must be in YYYY-MM-DD format');
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new AppError(400, 'Invalid date');
  }
  return true;
}
