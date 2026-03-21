import cron from "node-cron";
import { spawn } from "child_process";
import path from "path";
import { serverLogger } from "../logger";

/**
 * Runs the backtest pipeline (capture → actuals → validate) on a schedule.
 *
 * Schedule (ET):
 *   - 10:05 AM — capture today's projections (after lines are available)
 *   - 2:00 AM  — populate actuals for yesterday's games
 *   - 3:00 AM  — run validation / signal accuracy
 */

function getPythonCommand(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function runCronScript(command: string): Promise<{ success: boolean; output: string }> {
  const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "scripts", "cron_jobs.py");
  return new Promise((resolve) => {
    const proc = spawn(getPythonCommand(), [scriptPath, command]);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      resolve({ success: code === 0, output: stdout || stderr });
    });
    proc.on("error", (err) => {
      resolve({ success: false, output: err.message });
    });
  });
}

export function startBacktestScheduler() {
  // Capture projections at 10:05 AM ET daily
  cron.schedule("5 10 * * *", async () => {
    serverLogger.info("[Backtest Scheduler] Running projection capture...");
    const result = await runCronScript("capture");
    serverLogger.info(`[Backtest Scheduler] Capture ${result.success ? "succeeded" : "failed"}: ${result.output.trim().slice(0, 200)}`);
  }, { timezone: "America/New_York" });

  // Populate actuals at 2:00 AM ET daily
  cron.schedule("0 2 * * *", async () => {
    serverLogger.info("[Backtest Scheduler] Running actuals population...");
    const result = await runCronScript("actuals");
    serverLogger.info(`[Backtest Scheduler] Actuals ${result.success ? "succeeded" : "failed"}: ${result.output.trim().slice(0, 200)}`);
  }, { timezone: "America/New_York" });

  // Run validation at 3:00 AM ET daily
  cron.schedule("0 3 * * *", async () => {
    serverLogger.info("[Backtest Scheduler] Running validation...");
    const result = await runCronScript("validate");
    serverLogger.info(`[Backtest Scheduler] Validation ${result.success ? "succeeded" : "failed"}: ${result.output.trim().slice(0, 200)}`);
  }, { timezone: "America/New_York" });

  serverLogger.info("Backtest scheduler started — capture 10:05 AM, actuals 2 AM, validation 3 AM (ET)");
}
