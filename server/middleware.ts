/**
 * Express middleware configuration
 * Rate limiting, CORS, error handling, and request logging
 */

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { RATE_LIMIT_CONFIG } from "./constants";
import { apiLogger } from "./logger";

// ========================================
// CORS CONFIGURATION
// ========================================

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "https://courtside-edge.com",
  "https://www.courtside-edge.com",
  "http://courtside-edge.com",
  "http://www.courtside-edge.com",
  "http://76.13.100.125",
];

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      apiLogger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
});

// ========================================
// RATE LIMITING
// ========================================

/**
 * General API rate limiter
 * 100 requests per 15 minutes
 */
export const apiRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.WINDOW_MS,
  max: RATE_LIMIT_CONFIG.MAX_REQUESTS,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit. Please try again later.",
    retryAfter: Math.ceil(RATE_LIMIT_CONFIG.WINDOW_MS / 1000),
  },
  handler: (req, res, next, options) => {
    apiLogger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
      path: req.path,
      method: req.method,
    });
    res.status(429).json(options.message);
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === "/health" || req.path === "/api/health";
  },
});

/**
 * Stricter rate limiter for expensive operations
 * 20 requests per 15 minutes for sync, projections, etc.
 */
export const expensiveRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.WINDOW_MS,
  max: RATE_LIMIT_CONFIG.MAX_EXPENSIVE_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests for this resource",
    message: "This endpoint has stricter rate limits. Please try again later.",
    retryAfter: Math.ceil(RATE_LIMIT_CONFIG.WINDOW_MS / 1000),
  },
  handler: (req, res, next, options) => {
    apiLogger.warn(`Expensive endpoint rate limit exceeded for IP: ${req.ip}`, {
      path: req.path,
      method: req.method,
    });
    res.status(429).json(options.message);
  },
});

// ========================================
// REQUEST LOGGING
// ========================================

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? "warn" : "info";

    if (level === "warn") {
      apiLogger.warn(`${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    } else if (duration > 1000 || process.env.LOG_ALL_REQUESTS === "true") {
      // Only log slow requests or if verbose logging is enabled
      apiLogger.info(`${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: `${duration}ms`,
      });
    }
  });

  next();
}

// ========================================
// ERROR HANDLING
// ========================================

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  apiLogger.error("Unhandled error", err, {
    path: req.path,
    method: req.method,
    body: req.body,
  });

  // Don't leak error details in production
  const message = process.env.NODE_ENV === "production"
    ? "Internal server error"
    : err.message;

  const stack = process.env.NODE_ENV === "production"
    ? undefined
    : err.stack;

  res.status(500).json({
    error: message,
    stack,
  });
}

// ========================================
// HEALTH CHECK
// ========================================

export function healthCheck(req: Request, res: Response): void {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
}

// ========================================
// SECURITY HEADERS
// ========================================

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // XSS protection
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  next();
}
