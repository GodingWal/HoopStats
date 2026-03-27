/**
 * ShapExplainer — expandable SHAP explanation for a pick card.
 *
 * Shows a horizontal bar chart of the top contributing factors
 * that drove the ML model's prediction, with human-readable labels.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, BrainCircuit } from "lucide-react";

interface ShapDriver {
  feature: string;
  shap_value: number;
  feature_value: number;
  direction: string;
}

interface ShapExplainerProps {
  drivers: ShapDriver[];
  calibration?: string;
  calibrationShift?: number;
  rawProbOver?: number | null;
  probOver?: number | null;
  compact?: boolean;
}

/** Map raw XGBoost feature names to human-readable labels */
const FEATURE_LABELS: Record<string, string> = {
  edge_star_out: "Star Player Out",
  edge_b2b: "Back-to-Back",
  edge_blowout: "Blowout Risk",
  edge_pace: "Pace Matchup",
  edge_bad_defense: "Weak Defense",
  edge_minutes_stability: "Minutes Stability",
  edge_recent_form: "Recent Form",
  edge_home_road: "Home/Away Split",
  edge_line_movement: "Line Movement",
  total_edges_fired: "Total Edges",
  line_vs_avg_l10: "Line vs L10 Avg",
  line_vs_avg_l5: "Line vs L5 Avg",
  line_vs_season_avg: "Line vs Season Avg",
  team_pace_actual: "Team Pace",
  opp_pace_actual: "Opp Pace",
  pace_differential: "Pace Differential",
  opp_def_rating: "Opp Def Rating",
  opp_pts_allowed_to_pos: "Opp Pts to Position",
  player_vs_opp_hist_avg: "vs Opp History",
  minutes_avg_l10: "Mins Avg (L10)",
  minutes_avg_l5: "Mins Avg (L5)",
  minutes_floor_l10: "Mins Floor (L10)",
  minutes_stdev_l10: "Mins Volatility",
  home_away_diff: "Home/Away Diff",
  home_away_diff_pct: "Home/Away Diff %",
  is_home: "Home Game",
  days_rest: "Days Rest",
  is_b2b: "Back-to-Back Game",
  hit_rate_overall: "Overall Hit Rate",
  hit_rate_l10: "Hit Rate (L10)",
  usage_rate: "Usage Rate",
  ts_pct: "True Shooting %",
  projected_minutes: "Projected Minutes",
  season_game_number: "Games Played",
  streak_length: "Streak Length",
  trend_slope_l10: "Trend (L10)",
  consistency_score: "Consistency",
  ceiling_pct_l10: "Ceiling Hit % (L10)",
  floor_pct_l10: "Floor Hit % (L10)",
  games_missed_recently: "Recent Games Missed",
  referee_impact: "Referee Impact",
  fatigue_score: "Fatigue Score",
  injury_alpha: "Injury Alpha",
  defender_matchup: "Defender Matchup",
  defense_vs_position: "Def vs Position",
};

function getLabel(feature: string): string {
  return FEATURE_LABELS[feature] || feature.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function ShapExplainer({
  drivers,
  calibration,
  calibrationShift,
  rawProbOver,
  probOver,
  compact = false,
}: ShapExplainerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!drivers || drivers.length === 0) return null;

  // Find the max absolute SHAP value for scaling bars
  const maxAbsShap = Math.max(...drivers.map(d => Math.abs(Number(d.shap_value || 0))), 0.01);

  // Take top 8 drivers for expanded, top 3 for compact summary
  const displayDrivers = expanded ? drivers.slice(0, 8) : drivers.slice(0, 3);

  return (
    <div className="mt-2">
      {/* Toggle button */}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors w-full"
      >
        <BrainCircuit className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium">AI Prediction Breakdown</span>
        {expanded ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>

      {/* Compact inline preview when collapsed */}
      {!expanded && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {drivers.slice(0, 3).map((d, i) => {
            const val = Number(d.shap_value || 0);
            const isPositive = val > 0;
            return (
              <span
                key={i}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  isPositive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}
              >
                {getLabel(d.feature)}
                <span className="font-mono font-bold ml-0.5">
                  {isPositive ? "+" : ""}{Number(val || 0).toFixed(2)}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded SHAP bar chart */}
      {expanded && (
        <div className="mt-2 p-3 rounded-lg bg-slate-900/50 border border-slate-700/50 space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>Factor</span>
            <span>Impact on Prediction</span>
          </div>

          {/* Bar chart rows */}
          {displayDrivers.map((d, i) => {
            const val = Number(d.shap_value || 0);
            const isPositive = val > 0;
            const barWidthPct = Math.min((Math.abs(val) / maxAbsShap) * 100, 100);

            return (
              <div key={i} className="flex items-center gap-2 group">
                {/* Label */}
                <div className="w-[120px] shrink-0 text-[11px] text-muted-foreground truncate" title={getLabel(d.feature)}>
                  {getLabel(d.feature)}
                </div>

                {/* Bar visualization - centered at 0 */}
                <div className="flex-1 flex items-center h-5 relative">
                  {/* Center line */}
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600/50" />

                  {/* Bar */}
                  {isPositive ? (
                    <div className="absolute left-1/2 h-4 flex items-center">
                      <div
                        className="h-full bg-emerald-500/40 border border-emerald-500/60 rounded-r transition-all duration-300"
                        style={{ width: `${barWidthPct * 0.5}%`, minWidth: '4px' }}
                      />
                    </div>
                  ) : (
                    <div className="absolute right-1/2 h-4 flex items-center justify-end">
                      <div
                        className="h-full bg-rose-500/40 border border-rose-500/60 rounded-l transition-all duration-300"
                        style={{ width: `${barWidthPct * 0.5}%`, minWidth: '4px' }}
                      />
                    </div>
                  )}
                </div>

                {/* Value */}
                <div className={`w-[55px] shrink-0 text-right font-mono text-[11px] font-bold ${
                  isPositive ? "text-emerald-400" : "text-rose-400"
                }`}>
                  {isPositive ? "+" : ""}{Number(val || 0).toFixed(3)}
                </div>
              </div>
            );
          })}

          {/* Calibration info */}
          {calibration && calibration !== "none" && (
            <div className="pt-2 mt-1 border-t border-slate-700/50 flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                Calibrated ({calibration})
              </span>
              {calibrationShift != null && (
                <span className={`font-mono ${Number(calibrationShift || 0) > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {Number(calibrationShift || 0) > 0 ? "+" : ""}{Number(Number(calibrationShift || 0) * 100).toFixed(1)}%
                </span>
              )}
            </div>
          )}

          {/* ML probability */}
          {probOver != null && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>ML Probability (Over)</span>
              <span className="font-mono font-bold text-blue-400">
                {Number(Number(probOver || 0) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
