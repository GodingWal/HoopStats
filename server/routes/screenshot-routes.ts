/**
 * Screenshot Routes
 * Handles parsing PrizePicks bet screenshots
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { apiLogger } from "../logger";
import {
  parsePrizePicksScreenshot,
  calculateParlayResult,
  type ParsedParlay,
} from "../services/screenshot-parser";
import { storage } from "../storage";

const router = Router();

// Configure multer for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

/**
 * POST /api/screenshots/parse
 * Upload and parse a PrizePicks screenshot
 */
router.post("/parse", upload.single("screenshot"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No screenshot file provided" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "Screenshot parsing not available",
        message: "OpenAI API key not configured. Add OPENAI_API_KEY to your .env file.",
      });
    }

    apiLogger.info("Received screenshot for parsing", {
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    // Convert buffer to base64
    const base64Image = req.file.buffer.toString("base64");

    // Parse the screenshot
    const parsed = await parsePrizePicksScreenshot(base64Image, req.file.mimetype);

    // Calculate overall result
    const parlayStatus = calculateParlayResult(parsed.picks);

    res.json({
      success: true,
      data: {
        ...parsed,
        calculatedResult: parlayStatus,
      },
    });
  } catch (error) {
    apiLogger.error("Error parsing screenshot", error);
    res.status(500).json({
      error: "Failed to parse screenshot",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/screenshots/parse-base64
 * Parse a base64-encoded screenshot (for mobile apps or clipboard paste)
 */
router.post("/parse-base64", async (req: Request, res: Response) => {
  try {
    const { image, mimeType } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image data provided" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "Screenshot parsing not available",
        message: "OpenAI API key not configured",
      });
    }

    // Remove data URL prefix if present
    let base64Data = image;
    if (image.includes(",")) {
      base64Data = image.split(",")[1];
    }

    const detectedMimeType = mimeType || "image/png";

    apiLogger.info("Parsing base64 screenshot", { mimeType: detectedMimeType });

    const parsed = await parsePrizePicksScreenshot(base64Data, detectedMimeType);
    const parlayStatus = calculateParlayResult(parsed.picks);

    res.json({
      success: true,
      data: {
        ...parsed,
        calculatedResult: parlayStatus,
      },
    });
  } catch (error) {
    apiLogger.error("Error parsing base64 screenshot", error);
    res.status(500).json({
      error: "Failed to parse screenshot",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/screenshots/save-parlay
 * Save a parsed parlay to the tracker
 */
router.post("/save-parlay", async (req: Request, res: Response) => {
  try {
    const { parsedParlay }: { parsedParlay: ParsedParlay } = req.body;

    if (!parsedParlay || !parsedParlay.picks || parsedParlay.picks.length === 0) {
      return res.status(400).json({ error: "Invalid parlay data" });
    }

    // Convert parsed parlay to storage format
    const parlayData = {
      parlayType: parsedParlay.parlayType,
      numPicks: parsedParlay.picks.length,
      entryAmount: parsedParlay.entryAmount,
      payoutMultiplier: parsedParlay.potentialPayout / parsedParlay.entryAmount,
      result: "pending" as const,
    };

    // Convert picks to storage format
    const picksData = parsedParlay.picks.map(pick => {
      // Determine result based on actual value if available
      let result: "hit" | "miss" | "push" | "pending" = "pending";
      if (pick.actualValue !== undefined) {
        if (pick.side === "over") {
          result = pick.actualValue > pick.line ? "hit" : pick.actualValue < pick.line ? "miss" : "push";
        } else {
          result = pick.actualValue < pick.line ? "hit" : pick.actualValue > pick.line ? "miss" : "push";
        }
      }

      return {
        playerName: pick.playerName,
        team: pick.team,
        stat: pick.statAbbr,
        line: pick.line,
        side: pick.side,
        result,
        actualValue: pick.actualValue ?? null,
        gameDate: parsedParlay.screenshotDate,
      };
    });

    // Save to database
    const savedParlay = await storage.saveParlay(parlayData, picksData);

    // Check if all picks are complete and update parlay result
    const completedPicks = picksData.filter(p => p.result !== "pending");
    if (completedPicks.length === picksData.length) {
      const hits = completedPicks.filter(p => p.result === "hit").length;
      const totalPicks = picksData.length;

      // Flex play rules: 6-pick needs 5+ hits to win
      let parlayResult: "win" | "loss" | "push" = "loss";
      let profit = -parsedParlay.entryAmount;

      if (totalPicks === 6 && hits >= 5) {
        if (hits === 6) {
          parlayResult = "win";
          profit = parsedParlay.potentialPayout - parsedParlay.entryAmount;
        } else if (hits === 5) {
          // 5/6 typically pays 2x on flex
          parlayResult = "win";
          profit = parsedParlay.entryAmount; // 2x payout = 1x profit
        }
      } else if (totalPicks < 6 && hits === totalPicks) {
        parlayResult = "win";
        profit = parsedParlay.potentialPayout - parsedParlay.entryAmount;
      }

      await storage.updateParlayResult(savedParlay.id, parlayResult, profit);
    }

    res.json({
      success: true,
      parlayId: savedParlay.id,
      message: `Saved ${picksData.length}-pick parlay to tracker`,
    });
  } catch (error) {
    apiLogger.error("Error saving parlay from screenshot", error);
    res.status(500).json({
      error: "Failed to save parlay",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
