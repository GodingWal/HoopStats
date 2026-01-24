
import cron from "node-cron";
import { storage } from "../storage";

// Watch for high value edges
export class LineWatcherService {
    private isRunning = false;

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log("Line Watcher Service started...");

        // Run every 15 minutes
        cron.schedule("*/15 * * * *", async () => {
            await this.scanForEdges();
        });

        // Initial scan
        this.scanForEdges();
    }

    async scanForEdges() {
        console.log("Scanning for line value...");
        try {
            // 1. Refresh players/bets (simplified flow)
            const players = await storage.getPlayers();
            // Note: In a real app we might re-run the python model or fetch fresh odds here
            // For now, we reuse existing players/bets but check for unread alerts

            const bets = await storage.getPotentialBets();

            const highValueBets = bets.filter(b => (b.confidence === 'HIGH' || b.confidence === 'MEDIUM') && (b.edge_score || 0) > 4);

            for (const bet of highValueBets) {
                // Check if we already alerted this recently? 
                // For simplicity, we just create an alert. In production, check duplicates.

                await storage.createAlert({
                    title: `Line Alert: ${bet.player_name}`,
                    message: `${bet.recommendation} ${bet.line} ${bet.stat_type} has a ${bet.hit_rate}% hit rate!`,
                    type: "EDGE",
                    severity: "HIGH",
                    metadata: bet,
                });
            }

            console.log(`Scan complete. Found ${highValueBets.length} high value bets.`);
        } catch (error) {
            console.error("Line Watcher Error:", error);
        }
    }
}

export const lineWatcher = new LineWatcherService();
