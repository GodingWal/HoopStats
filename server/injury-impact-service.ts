import { injuryWatcher } from "./injury-watcher";
import { storage } from "./storage";
import { analyzeEdges } from "./edge-detection";
import type { Player } from "@shared/schema";
import { log } from "./index";

/**
 * Service that automatically recalculates bet edges when injuries are detected
 */
class InjuryImpactService {
  private isRunning = false;

  start() {
    if (this.isRunning) {
      log("Injury impact service already running", "injury-impact");
      return;
    }

    this.isRunning = true;

    // Listen for injury updates
    injuryWatcher.on("injuriesUpdated", async (injuries) => {
      log(`Injury update detected: ${injuries.length} total injuries`, "injury-impact");

      // Get affected teams
      const affectedTeams = new Set(injuries.map(inj => inj.team));
      log(`Affected teams: ${Array.from(affectedTeams).join(", ")}`, "injury-impact");

      // Recalculate edges for players on affected teams
      await this.recalculateBetEdges(Array.from(affectedTeams));
    });

    log("Injury impact service started - monitoring for injury-driven edge changes", "injury-impact");
  }

  stop() {
    this.isRunning = false;
    log("Injury impact service stopped", "injury-impact");
  }

  /**
   * Recalculate bet edges for players on teams with injury updates
   */
  private async recalculateBetEdges(teams: string[]) {
    try {
      // Get all players from affected teams
      const allPlayers = await storage.getPlayers();
      const affectedPlayers = allPlayers.filter(p => teams.includes(p.team));

      log(`Recalculating edges for ${affectedPlayers.length} players on affected teams`, "injury-impact");

      // Get current potential bets
      const currentBets = await storage.getPotentialBets();

      let updatedCount = 0;
      let newEdgesFound = 0;

      // Recalculate edges for each affected player's bets
      for (const bet of currentBets) {
        const player = affectedPlayers.find(p => p.player_id === bet.player_id);
        if (!player) continue;

        // Recalculate edge analysis
        const edgeAnalysis = analyzeEdges(
          player,
          bet.stat_type,
          bet.recommendation,
          bet.hit_rate
        );

        // Check if edge changed
        const oldEdgeScore = bet.edge_score || 0;
        const newEdgeScore = edgeAnalysis.totalScore || 0;

        if (oldEdgeScore !== newEdgeScore) {
          // Update the bet with new edge information
          await storage.updatePotentialBet(bet.id!, {
            edge_type: edgeAnalysis.bestEdge?.type || null,
            edge_score: newEdgeScore || null,
            edge_description: edgeAnalysis.bestEdge?.description || null,
          });

          updatedCount++;

          // Log significant new edges (STAR_OUT detection)
          if (edgeAnalysis.bestEdge?.type === "STAR_OUT" && oldEdgeScore < 10) {
            newEdgesFound++;
            log(
              `🎯 NEW STAR_OUT EDGE: ${player.player_name} ${bet.stat_type} ${bet.recommendation} - ${edgeAnalysis.bestEdge.description}`,
              "injury-impact"
            );
          }
        }
      }

      log(
        `Injury impact recalculation complete: ${updatedCount} bets updated, ${newEdgesFound} new high-value edges found`,
        "injury-impact"
      );
    } catch (error) {
      log(`Error recalculating bet edges: ${error}`, "injury-impact");
    }
  }

  /**
   * Get injury impact report for a specific team
   */
  async getTeamInjuryImpact(team: string): Promise<{
    injuries: Array<{ playerName: string; status: string; description: string }>;
    beneficiaries: Array<{
      playerName: string;
      stat: string;
      impact: number;
      recommendation: string;
    }>;
  }> {
    const injuries = injuryWatcher.getTeamOutPlayers(team);
    const players = await storage.getPlayers();
    const teamPlayers = players.filter(p => p.team === team);

    const beneficiaries: Array<{
      playerName: string;
      stat: string;
      impact: number;
      recommendation: string;
    }> = [];

    // Find players who benefit from these injuries
    for (const player of teamPlayers) {
      const onOffSplits = player.on_off_splits || [];

      for (const split of onOffSplits) {
        // Check if any injured player matches this on/off split
        const matchingInjury = injuries.find(inj =>
          inj.playerName.toLowerCase().includes(split.without_player.toLowerCase()) ||
          split.without_player.toLowerCase().includes(inj.playerName.toLowerCase())
        );

        if (matchingInjury && split.impact > 3.0) {
          beneficiaries.push({
            playerName: player.player_name,
            stat: split.stat,
            impact: split.impact,
            recommendation: "OVER",
          });
        }
      }
    }

    return {
      injuries: injuries.map(inj => ({
        playerName: inj.playerName,
        status: inj.status,
        description: inj.description,
      })),
      beneficiaries: beneficiaries.sort((a, b) => b.impact - a.impact),
    };
  }
}

export const injuryImpactService = new InjuryImpactService();
