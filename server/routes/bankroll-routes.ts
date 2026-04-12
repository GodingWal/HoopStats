/**
 * Bankroll management API routes
 */

import { Router } from "express";
import { db } from "../db";
import { parlays, parlayPicks } from "@shared/schema";
import { desc, and, isNotNull, ne } from "drizzle-orm";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import { kellyFraction } from "../utils/ev-calculator";

const router = Router();

function assertDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

/**
 * GET /api/bankroll/summary
 * Returns current balance, P/L, ROI, streak, and stats
 */
router.get("/summary", async (_req, res) => {
  try {
    const database = assertDb();

    // Get all settled parlays ordered by date
    const settledParlays = await database
      .select()
      .from(parlays)
      .where(
        and(
          isNotNull(parlays.result),
          ne(parlays.result, "pending")
        )
      )
      .orderBy(desc(parlays.placedAt));

    const totalParlays = settledParlays.length;
    const wins = settledParlays.filter(p => p.result === "win").length;
    const losses = settledParlays.filter(p => p.result === "loss").length;
    const totalProfit = settledParlays.reduce((sum, p) => sum + (p.profit || 0), 0);
    const totalRisked = settledParlays.reduce((sum, p) => sum + p.entryAmount, 0);
    const roi = totalRisked > 0 ? (totalProfit / totalRisked) * 100 : 0;
    const winRate = totalParlays > 0 ? (wins / totalParlays) * 100 : 0;

    // Calculate current streak
    let currentStreak = 0;
    let streakType: "win" | "loss" | "none" = "none";
    for (const p of settledParlays) {
      if (streakType === "none") {
        streakType = p.result === "win" ? "win" : "loss";
        currentStreak = 1;
      } else if (p.result === streakType) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Get all settled picks for pick-level stats
    const settledPicks = await database
      .select()
      .from(parlayPicks)
      .where(
        and(
          isNotNull(parlayPicks.result),
          ne(parlayPicks.result, "pending")
        )
      );

    const totalPicks = settledPicks.length;
    const hitPicks = settledPicks.filter(p => p.result === "hit").length;
    const pickHitRate = totalPicks > 0 ? (hitPicks / totalPicks) * 100 : 0;

    // Today's P/L
    const today = new Date().toISOString().split("T")[0];
    const todayParlays = settledParlays.filter(p => {
      const placedDate = new Date(p.placedAt).toISOString().split("T")[0];
      return placedDate === today;
    });
    const todayPL = todayParlays.reduce((sum, p) => sum + (p.profit || 0), 0);

    // Best and worst day
    const dailyPL: Record<string, number> = {};
    for (const p of settledParlays) {
      const d = new Date(p.placedAt).toISOString().split("T")[0];
      dailyPL[d] = (dailyPL[d] || 0) + (p.profit || 0);
    }
    const days = Object.entries(dailyPL);
    const bestDay = days.length > 0 ? days.reduce((a, b) => a[1] > b[1] ? a : b) : null;
    const worstDay = days.length > 0 ? days.reduce((a, b) => a[1] < b[1] ? a : b) : null;

    // Unit size recommendations based on Kelly criterion
    const defaultBankroll = 1000;
    const kellyRecommendations = [
      { tier: "HIGH", estimatedProb: 0.72, odds: BETTING_CONFIG.DEFAULT_ODDS },
      { tier: "MEDIUM", estimatedProb: 0.60, odds: BETTING_CONFIG.DEFAULT_ODDS },
      { tier: "LOW", estimatedProb: 0.52, odds: BETTING_CONFIG.DEFAULT_ODDS },
    ].map(({ tier, estimatedProb, odds }) => {
      const fullKelly = kellyFraction(estimatedProb, odds);
      const quarterKelly = fullKelly * BETTING_CONFIG.KELLY_FRACTION;
      return {
        tier,
        fullKellyPct: Number((fullKelly * 100).toFixed(2)),
        quarterKellyPct: Number((quarterKelly * 100).toFixed(2)),
        recommendedUnit: Number((defaultBankroll * quarterKelly).toFixed(2)),
      };
    });

    res.json({
      totalProfit: Number(Number(totalProfit).toFixed(2)),
      totalRisked: Number(Number(totalRisked).toFixed(2)),
      roi: Number(Number(roi).toFixed(1)),
      winRate: Number(Number(winRate).toFixed(1)),
      totalParlays,
      wins,
      losses,
      todayPL: Number(Number(todayPL).toFixed(2)),
      currentStreak: streakType === "none" ? 0 : (streakType === "win" ? currentStreak : -currentStreak),
      streakType,
      pickHitRate: Number(Number(pickHitRate).toFixed(1)),
      totalPicks,
      hitPicks,
      bestDay: bestDay ? { date: bestDay[0], profit: Number(Number(bestDay[1]).toFixed(2)) } : null,
      worstDay: worstDay ? { date: worstDay[0], profit: Number(Number(worstDay[1]).toFixed(2)) } : null,
      kellyRecommendations,
    });
  } catch (error) {
    apiLogger.error("Error fetching bankroll summary", error);
    res.status(500).json({ error: "Failed to fetch bankroll summary" });
  }
});

/**
 * GET /api/bankroll/history
 * Returns daily bankroll values for chart
 */
router.get("/history", async (req, res) => {
  try {
    const database = assertDb();
    const startingBankroll = Number(req.query.startingBankroll) || 1000;

    // Get all parlays ordered by placed date
    const allParlays = await database
      .select()
      .from(parlays)
      .orderBy(parlays.placedAt);

    // Build daily P/L map
    const dailyPL: Record<string, { profit: number; bets: number; wins: number; losses: number }> = {};

    for (const p of allParlays) {
      const d = new Date(p.placedAt).toISOString().split("T")[0];
      if (!dailyPL[d]) {
        dailyPL[d] = { profit: 0, bets: 0, wins: 0, losses: 0 };
      }
      dailyPL[d].bets++;
      if (p.result === "win" || p.result === "loss") {
        dailyPL[d].profit += (p.profit || 0);
        if (p.result === "win") dailyPL[d].wins++;
        if (p.result === "loss") dailyPL[d].losses++;
      }
    }

    // Sort by date and build cumulative balance
    const sortedDays = Object.entries(dailyPL).sort((a, b) => a[0].localeCompare(b[0]));
    let runningBalance = startingBankroll;
    const history = sortedDays.map(([date, data]) => {
      runningBalance += data.profit;
      return {
        date,
        balance: Number(Number(runningBalance).toFixed(2)),
        dailyPL: Number(Number(data.profit).toFixed(2)),
        bets: data.bets,
        wins: data.wins,
        losses: data.losses,
      };
    });

    // Add starting point
    if (history.length > 0) {
      const firstDate = new Date(history[0].date);
      firstDate.setDate(firstDate.getDate() - 1);
      history.unshift({
        date: firstDate.toISOString().split("T")[0],
        balance: startingBankroll,
        dailyPL: 0,
        bets: 0,
        wins: 0,
        losses: 0,
      });
    }

    res.json({
      startingBankroll,
      currentBalance: history.length > 0 ? history[history.length - 1].balance : startingBankroll,
      history,
    });
  } catch (error) {
    apiLogger.error("Error fetching bankroll history", error);
    res.status(500).json({ error: "Failed to fetch bankroll history" });
  }
});

/**
 * POST /api/bankroll/settings
 * Validates bankroll settings (stored client-side in localStorage)
 */
router.post("/settings", async (req, res) => {
  try {
    const { startingBankroll, unitSize } = req.body;

    if (typeof startingBankroll !== "number" || startingBankroll <= 0) {
      return res.status(400).json({ error: "Starting bankroll must be a positive number" });
    }

    if (unitSize !== undefined && (typeof unitSize !== "number" || unitSize <= 0)) {
      return res.status(400).json({ error: "Unit size must be a positive number" });
    }

    res.json({
      startingBankroll,
      unitSize: unitSize || startingBankroll * 0.01,
      message: "Settings saved successfully",
    });
  } catch (error) {
    apiLogger.error("Error saving bankroll settings", error);
    res.status(500).json({ error: "Failed to save bankroll settings" });
  }
});

export default router;

