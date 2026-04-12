/**
 * SignalBreakdown — collapsible signal agreement section for bet cards.
 *
 * Shows:
 * - Signal agreement bar (e.g. "5/7 signals agree")
 * - Individual signal breakdown (name, agrees/disagrees, weight, accuracy)
 * - Calibrated probability
 * - ML signals fired
 * - XGBoost top SHAP drivers (compact)
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Activity, Check, X } from "lucide-react";

interface SignalDetail {
  name: string;
  agrees: boolean;
  weight: number;
  accuracy: number;
}

interface ShapDriver {
  feature: string;
  shap_value: number;
  feature_value: number;
  direction: string;
}

interface SignalBreakdownProps {
  agreingSignals?: number;
  totalSignals?: number;
  signalDetails?: SignalDetail[];
  calibratedProbability?: number;
  mlSignalsFired?: string[];
  shapDrivers?: ShapDriver[];
}

const SIGNAL_LABELS: Record<string, string> = {
  HIT_RATE: "Hit Rate",
  SEASON_AVG: "Season Avg",
  RECENT_FORM: "Recent Form",
  TREND: "Trend",
  CONFIDENCE: "Confidence",
  EDGE_SCORE: "Edge Score",
  EDGE_TYPE: "Edge Type",
  XGB_DIRECTION: "XGB Direction",
};

function getSignalLabel(name: string): string {
  return SIGNAL_LABELS[name] || name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getFeatureLabel(feature: string): string {
  const map: Record<string, string> = {
    line_vs_avg_l10: "line vs L10 avg",
    line_vs_avg_l5: "line vs L5 avg",
    line_vs_season_avg: "line vs season avg",
    hit_rate_overall: "hit rate",
    hit_rate_l10: "hit rate (L10)",
    opp_def_rating: "opp def rating",
    pace_differential: "pace diff",
    is_b2b: "back-to-back",
    injury_alpha: "injury alpha",
    defender_matchup: "defender matchup",
  };
  return map[feature] || feature.replace(/_/g, " ");
}

export function SignalBreakdown({
  agreingSignals,
  totalSignals,
  signalDetails,
  calibratedProbability,
  mlSignalsFired,
  shapDrivers,
}: SignalBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  const hasSignalData =
    (agreingSignals != null && totalSignals != null && totalSignals > 0) ||
    (signalDetails && signalDetails.length > 0) ||
    calibratedProbability != null ||
    (mlSignalsFired && mlSignalsFired.length > 0) ||
    (shapDrivers && shapDrivers.length > 0);

  if (!hasSignalData) return null;

  const agreementPct =
    agreingSignals != null && totalSignals != null && totalSignals > 0
      ? agreingSignals / totalSignals
      : null;

  const barColor =
    agreementPct == null
      ? "bg-zinc-500"
      : agreementPct >= 0.7
      ? "bg-emerald-500"
      : agreementPct >= 0.5
      ? "bg-yellow-500"
      : "bg-rose-500";

  const topShap = shapDrivers ? shapDrivers.slice(0, 3) : [];

  return (
    <div className="mt-1.5">
      {/* Toggle row */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full"
      >
        <Activity className="w-3.5 h-3.5 shrink-0" />

        {/* Inline agreement bar when collapsed */}
        {!expanded && agreementPct != null && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="font-medium">
              {agreingSignals}/{totalSignals} signals agree
            </span>
            <div className="flex-1 max-w-[60px] h-1.5 bg-slate-700 rounded overflow-hidden">
              <div
                className={`h-full ${barColor} rounded transition-all`}
                style={{ width: `${Math.round(agreementPct * 100)}%` }}
              />
            </div>
            {calibratedProbability != null && (
              <span className="font-mono text-slate-500">
                {Math.round(calibratedProbability * 100)}% cal
              </span>
            )}
          </div>
        )}

        {expanded && <span className="font-medium">Signal Details</span>}

        {expanded ? (
          <ChevronUp className="w-3 h-3 ml-auto shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 ml-auto shrink-0" />
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-1.5 p-3 rounded-lg bg-slate-900/50 border border-slate-700/50 space-y-3">

          {/* Agreement bar */}
          {agreementPct != null && (
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400">Signal Agreement</span>
                <span className={`font-mono font-bold ${barColor.replace("bg-", "text-")}`}>
                  {agreingSignals}/{totalSignals}
                </span>
              </div>
              <div className="h-2 bg-slate-700 rounded overflow-hidden">
                <div
                  className={`h-full ${barColor} rounded transition-all`}
                  style={{ width: `${Math.round(agreementPct * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Individual signals */}
          {signalDetails && signalDetails.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Signals</div>
              {signalDetails.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  {s.agrees ? (
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <X className="w-3 h-3 text-rose-400 shrink-0" />
                  )}
                  <span className={`flex-1 ${s.agrees ? "text-slate-300" : "text-slate-500"}`}>
                    {getSignalLabel(s.name)}
                  </span>
                  <span className="text-slate-500 font-mono text-[10px]">
                    w:{Number(s.weight || 0).toFixed(2)}
                  </span>
                  {s.accuracy > 0 && (
                    <span className="text-slate-500 font-mono text-[10px]">
                      {Math.round(s.accuracy * 100)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Calibrated probability */}
          {calibratedProbability != null && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Calibrated Confidence</span>
              <span className={`font-mono font-bold ${
                calibratedProbability >= 0.65
                  ? "text-emerald-400"
                  : calibratedProbability >= 0.55
                  ? "text-yellow-400"
                  : "text-slate-400"
              }`}>
                {Math.round(calibratedProbability * 100)}%
              </span>
            </div>
          )}

          {/* ML signals fired */}
          {mlSignalsFired && mlSignalsFired.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Driven by</div>
              <div className="flex flex-wrap gap-1">
                {mlSignalsFired.map((sig, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  >
                    {sig.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* XGBoost top SHAP drivers */}
          {topShap.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">XGB Top Factors</div>
              <div className="flex flex-wrap gap-1">
                {topShap.map((d, i) => {
                  const val = Number(d.shap_value || 0);
                  const isPos = val > 0;
                  return (
                    <span
                      key={i}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        isPos
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      {getFeatureLabel(d.feature)} ({isPos ? "+" : ""}{val.toFixed(2)})
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
