import type { Express } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import type { Player, HitRateEntry } from "@shared/schema";
import { injuryWatcher, calculateInjuryAdjustedProjection, calculateInjuryEdgeChange } from "../injury-watcher";
import { fetchTodaysGameInjuries, fetchAllNbaInjuries, getTeamOutPlayers, type PlayerInjuryReport } from "../espn-api";
import { ensurePlayersLoaded, parseHitRateEntry } from "./route-helpers";

export function registerInjuryRoutes(app: Express): void {
  app.get("/api/injuries/status", async (_req, res) => {
    try {
      res.json({
        isActive: injuryWatcher.isActive(),
        lastCheck: injuryWatcher.getLastCheckTime(),
        knownInjuries: injuryWatcher.getKnownInjuries().length,
      });
    } catch (error) {
      apiLogger.error("Error fetching injury status:", error);
      res.status(500).json({ error: "Failed to fetch injury status" });
    }
  });

  // Start injury monitoring
  app.post("/api/injuries/start", async (req, res) => {
    try {
      const intervalMs = parseInt(req.query.interval as string) || 60000;
      await injuryWatcher.start(intervalMs);
      res.json({
        success: true,
        message: `Injury watcher started with ${intervalMs}ms interval`,
        isActive: injuryWatcher.isActive(),
      });
    } catch (error) {
      apiLogger.error("Error starting injury watcher:", error);
      res.status(500).json({ error: "Failed to start injury watcher" });
    }
  });

  // Stop injury monitoring
  app.post("/api/injuries/stop", async (_req, res) => {
    try {
      injuryWatcher.stop();
      res.json({
        success: true,
        message: "Injury watcher stopped",
        isActive: injuryWatcher.isActive(),
      });
    } catch (error) {
      apiLogger.error("Error stopping injury watcher:", error);
      res.status(500).json({ error: "Failed to stop injury watcher" });
    }
  });

  // Force check for injury updates
  app.post("/api/injuries/check", async (_req, res) => {
    try {
      const changes = await injuryWatcher.forceCheck();
      res.json({
        success: true,
        changes,
        changesCount: changes.length,
        lastCheck: injuryWatcher.getLastCheckTime(),
      });
    } catch (error) {
      apiLogger.error("Error checking injuries:", error);
      res.status(500).json({ error: "Failed to check injuries" });
    }
  });

  // Get all current injuries for teams playing today
  app.get("/api/injuries/today", async (_req, res) => {
    try {
      const injuries = await fetchTodaysGameInjuries();
      res.json({
        injuries,
        count: injuries.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching today's injuries:", error);
      res.status(500).json({ error: "Failed to fetch today's injuries" });
    }
  });

  // Get all NBA injuries (league-wide)
  app.get("/api/injuries/all", async (_req, res) => {
    try {
      const injuries = await fetchAllNbaInjuries();
      res.json({
        injuries,
        count: injuries.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching all injuries:", error);
      res.status(500).json({ error: "Failed to fetch all injuries" });
    }
  });

  // Get injuries for a specific team
  app.get("/api/injuries/team/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      // Try to get from watcher first (if active), otherwise fetch fresh
      let injuries: PlayerInjuryReport[] = [];
      if (injuryWatcher.isActive()) {
        const watcherInjuries = injuryWatcher.getTeamInjuries(teamAbbr.toUpperCase());
        injuries = watcherInjuries.map(inj => ({
          playerId: inj.playerId,
          playerName: inj.playerName,
          team: inj.team,
          teamId: 0,
          status: inj.status,
          injuryType: inj.injuryType,
          description: inj.description,
          source: 'espn' as const,
        }));
      } else {
        const allInjuries = await fetchTodaysGameInjuries();
        injuries = allInjuries.filter(inj => inj.team === teamAbbr.toUpperCase());
      }

      res.json({
        team: teamAbbr.toUpperCase(),
        injuries,
        count: injuries.length,
        outPlayers: injuries.filter(i => i.status === 'out').map(i => i.playerName),
      });
    } catch (error) {
      apiLogger.error("Error fetching team injuries:", error);
      res.status(500).json({ error: "Failed to fetch team injuries" });
    }
  });

  // Get players who are OUT for a team (useful for projection adjustments)
  app.get("/api/injuries/out/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const outPlayers = await getTeamOutPlayers(teamAbbr.toUpperCase());
      res.json({
        team: teamAbbr.toUpperCase(),
        outPlayers,
        count: outPlayers.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching out players:", error);
      res.status(500).json({ error: "Failed to fetch out players" });
    }
  });

  // Get injury-adjusted projection for a player
  app.get("/api/injuries/projection/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      const team = req.query.team as string;

      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      // Get injured teammates
      const outPlayers = team ? await getTeamOutPlayers(team.toUpperCase()) : [];

      // Get baseline projection (without injuries)
      const baseline = await calculateInjuryAdjustedProjection(
        decodeURIComponent(playerName),
        []
      );

      // Get adjusted projection (with injuries)
      const adjusted = await calculateInjuryAdjustedProjection(
        decodeURIComponent(playerName),
        outPlayers
      );

      if (!baseline && !adjusted) {
        return res.status(404).json({ error: "Could not generate projections" });
      }

      res.json({
        playerName: decodeURIComponent(playerName),
        team: team?.toUpperCase(),
        injuredTeammates: outPlayers,
        baseline: baseline?.projection,
        adjusted: adjusted?.projection,
        hasInjuryImpact: outPlayers.length > 0,
        context: adjusted?.context || baseline?.context,
      });
    } catch (error) {
      apiLogger.error("Error fetching injury-adjusted projection:", error);
      res.status(500).json({ error: "Failed to fetch projection" });
    }
  });

  // Get injury edge impact for a specific player prop
  app.get("/api/injuries/edge/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      const team = req.query.team as string;
      const stat = req.query.stat as string;
      const line = parseFloat(req.query.line as string);

      if (!playerName || !team || !stat || isNaN(line)) {
        return res.status(400).json({
          error: "Missing required parameters",
          required: ["playerName", "team", "stat", "line"],
        });
      }

      const impact = await calculateInjuryEdgeChange(
        decodeURIComponent(playerName),
        team.toUpperCase(),
        stat,
        line
      );

      if (!impact) {
        return res.status(404).json({ error: "Could not calculate injury impact" });
      }

      res.json({
        playerName: decodeURIComponent(playerName),
        team: team.toUpperCase(),
        stat,
        line,
        ...impact,
        recommendation: impact.isOpportunity
          ? impact.edgeChange > 0
            ? "OVER opportunity due to teammate injuries"
            : "UNDER opportunity due to teammate injuries"
          : "No significant edge change from injuries",
      });
    } catch (error) {
      apiLogger.error("Error calculating injury edge:", error);
      res.status(500).json({ error: "Failed to calculate injury edge" });
    }
  });

  // Get all injury-affected opportunities (players with significant edge changes)
  app.get("/api/injuries/opportunities", async (req, res) => {
    try {
      const minEdgeChange = parseFloat(req.query.minEdge as string) || 0.05;

      // Get today's injuries
      const injuries = await fetchTodaysGameInjuries();
      const outByTeam = new Map<string, string[]>();

      // Group OUT players by team
      for (const inj of injuries) {
        if (inj.status === 'out') {
          const teamOuts = outByTeam.get(inj.team) || [];
          teamOuts.push(inj.playerName);
          outByTeam.set(inj.team, teamOuts);
        }
      }

      // Return teams with OUT players and their impact summary
      const opportunities = Array.from(outByTeam.entries()).map(([team, outPlayers]) => ({
        team,
        outPlayers,
        outCount: outPlayers.length,
        impactLevel: outPlayers.length >= 2 ? 'high' : outPlayers.length === 1 ? 'medium' : 'low',
        recommendation: `Check projections for ${team} players - ${outPlayers.length} key player(s) out`,
      }));

      res.json({
        opportunities: opportunities.filter(o => o.outCount > 0),
        teamsAffected: opportunities.length,
        totalPlayersOut: injuries.filter(i => i.status === 'out').length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching injury opportunities:", error);
      res.status(500).json({ error: "Failed to fetch injury opportunities" });
    }
  });

  // Get injury alerts with betting impact for dashboard widget
  app.get("/api/injuries/alerts", async (_req, res) => {
    try {
      // Get all current injuries from injury watcher
      const allInjuries = injuryWatcher.getKnownInjuries();
      const significantInjuries = allInjuries.filter(
        inj => inj.status === 'out' || inj.status === 'doubtful'
      );

      // Group by team
      const byTeam: Record<string, typeof significantInjuries> = {};
      for (const inj of significantInjuries) {
        if (!byTeam[inj.team]) byTeam[inj.team] = [];
        byTeam[inj.team].push(inj);
      }

      const getOutCount = (injuries: typeof significantInjuries) =>
        injuries.filter(i => i.status === 'out').length;

      const getImpactLevel = (injuries: typeof significantInjuries): 'high' | 'medium' | 'low' => {
        const outs = getOutCount(injuries);
        if (outs >= 2) return 'high';
        if (outs === 1) return 'medium';
        return 'low';
      };

      const alerts = Object.entries(byTeam).map(([team, injuries]) => ({
        team,
        injuries: injuries.map(inj => ({
          playerName: inj.playerName,
          status: inj.status,
          description: inj.description || inj.injuryType || 'Injury',
        })),
        beneficiaries: [] as Array<{ playerName: string; stat: string; impact: number; recommendation: string }>,
        impactLevel: getImpactLevel(injuries),
      }));

      // Sort: high impact first, then by number of out injuries
      const sortedAlerts = alerts.sort((a, b) => {
        const impactOrder = { high: 3, medium: 2, low: 1 };
        const diff =
          impactOrder[b.impactLevel as keyof typeof impactOrder] -
          impactOrder[a.impactLevel as keyof typeof impactOrder];
        if (diff !== 0) return diff;
        return getOutCount(byTeam[b.team]) - getOutCount(byTeam[a.team]);
      });

      const outInjuries = allInjuries.filter(inj => inj.status === 'out');

      res.json({
        alerts: sortedAlerts,
        totalInjuries: outInjuries.length,
        teamsAffected: Object.keys(byTeam).length,
        highImpactAlerts: sortedAlerts.filter(a => a.impactLevel === 'high').length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching injury alerts:", error);
      res.status(500).json({ error: "Failed to fetch injury alerts" });
    }
  });

  // Projection with injury context (POST version for more flexibility)
}
