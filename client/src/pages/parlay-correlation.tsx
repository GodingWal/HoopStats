import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, RefreshCw, Zap, TrendingUp } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Recommendation = "SMASH" | "STRONG" | "LEAN" | "AVOID" | "SKIP";
type ParlayType = "CORRELATED_POSITIVE" | "CORRELATED_NEGATIVE" | "INDEPENDENT";
type ParlayTemplate = "PACE_STACK" | "INJURY_STACK" | "DEFENSE_EXPLOIT" | "FADE_STACK";

interface ParlayLeg {
  player_id: string;
  player_name: string;
  team: string;
  stat: string;
  line: number;
  projection: number;
  edge: number;
  hit_prob: number;
  direction: "OVER" | "UNDER";
  confidence_tier: string;
}

interface CorrelationDetail {
  pair: [string, string];
  stat: string;
  correlation: number;
  relationship: string;
  ev_adjustment: number;
  same_team: boolean;
  same_game: boolean;
}

interface Parlay {
  id: number;
  legs: ParlayLeg[];
  correlations: CorrelationDetail[];
  parlay_type: ParlayType;
  parlay_template: ParlayTemplate;
  leg_count: number;
  base_hit_prob: number;
  true_hit_prob: number;
  payout: number;
  combined_ev: number;
  recommendation: Recommendation;
  avoid_reason: string | null;
  outcome: boolean | null;
  payout_received: number | null;
  game_date: string;
  created_at: string;
}

interface ParlaysResponse {
  date: string;
  parlays: Parlay[];
  count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RECOMMENDATION_STYLES: Record<Recommendation, string> = {
  SMASH: "text-[#00ffc8] font-bold border-[#00ffc8]/50 bg-[#00ffc8]/10",
  STRONG: "text-green-400 font-semibold border-green-400/50 bg-green-400/10",
  LEAN: "text-yellow-400 font-medium border-yellow-400/50 bg-yellow-400/10",
  AVOID: "text-rose-400 font-medium border-rose-400/50 bg-rose-400/10",
  SKIP: "text-gray-500 border-gray-500/30 bg-gray-500/5",
};

const ROW_STYLES: Record<Recommendation, string> = {
  SMASH: "border-l-2 border-l-[#00ffc8] bg-[#00ffc8]/5 hover:bg-[#00ffc8]/8",
  STRONG: "border-l-2 border-l-green-500 bg-green-500/5 hover:bg-green-500/8",
  LEAN: "border-l-2 border-l-yellow-500 bg-yellow-500/5 hover:bg-yellow-500/8",
  AVOID: "border-l-2 border-l-rose-500 bg-rose-500/5 hover:bg-rose-500/8 opacity-60",
  SKIP: "border-l-2 border-l-gray-600 opacity-40 hover:opacity-60",
};

const TEMPLATE_LABELS: Record<ParlayTemplate, string> = {
  PACE_STACK: "Pace Stack",
  INJURY_STACK: "Injury Stack",
  DEFENSE_EXPLOIT: "Defense Exploit",
  FADE_STACK: "Fade Stack",
};

const TEMPLATE_COLORS: Record<ParlayTemplate, string> = {
  PACE_STACK: "text-[#00ffc8] border-[#00ffc8]/30",
  INJURY_STACK: "text-orange-400 border-orange-400/30",
  DEFENSE_EXPLOIT: "text-purple-400 border-purple-400/30",
  FADE_STACK: "text-rose-400 border-rose-400/30",
};

function fmt(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return Number(val).toFixed(decimals);
}

function corrColor(corr: number): string {
  if (corr > 0.35) return "text-[#00ffc8]";
  if (corr > 0.15) return "text-green-400";
  if (corr < -0.35) return "text-rose-500";
  if (corr < -0.15) return "text-rose-400";
  return "text-gray-400";
}

function evColor(ev: number): string {
  if (ev > 0.25) return "text-[#00ffc8]";
  if (ev > 0.15) return "text-green-400";
  if (ev > 0.05) return "text-yellow-400";
  if (ev < 0) return "text-rose-400";
  return "text-gray-400";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Correlation Bar ─────────────────────────────────────────────────────────

function CorrBar({ corr }: { corr: number }) {
  const pct = Math.abs(corr) * 100;
  const positive = corr >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${positive ? "bg-[#00ffc8]" : "bg-rose-500"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`font-mono text-xs ${corrColor(corr)}`}>
        {corr >= 0 ? "+" : ""}
        {fmt(corr, 3)}
      </span>
    </div>
  );
}

// ─── Leg Row ─────────────────────────────────────────────────────────────────

function LegRow({ leg }: { leg: ParlayLeg }) {
  const dir =
    leg.direction === "OVER" ? "text-[#00ffc8]" : "text-rose-400";
  const edge = leg.edge ?? 0;
  return (
    <tr className="text-xs border-t border-white/5">
      <td className="py-1.5 px-3 font-mono text-white">{leg.player_name}</td>
      <td className="py-1.5 px-2 font-mono text-gray-400">{leg.team}</td>
      <td className="py-1.5 px-2 font-mono text-gray-300 uppercase">{leg.stat}</td>
      <td className="py-1.5 px-2 font-mono text-gray-300">{fmt(leg.line)}</td>
      <td className="py-1.5 px-2 font-mono text-[#00ffc8]">{fmt(leg.projection)}</td>
      <td className={`py-1.5 px-2 font-mono ${dir}`}>{leg.direction}</td>
      <td className={`py-1.5 px-2 font-mono ${edge > 5 ? "text-[#00ffc8]" : edge > 3 ? "text-green-400" : "text-gray-400"}`}>
        {edge >= 0 ? "+" : ""}{fmt(edge, 1)}%
      </td>
      <td className="py-1.5 px-2 font-mono text-gray-400">{fmt((leg.hit_prob ?? 0.5) * 100, 0)}%</td>
    </tr>
  );
}

// ─── Parlay Row ───────────────────────────────────────────────────────────────

function ParlayRow({ parlay }: { parlay: Parlay }) {
  const [open, setOpen] = useState(false);
  const rec = parlay.recommendation as Recommendation;

  const playerNames = parlay.legs?.map((l) => l.player_name).join(" + ") || "—";
  const stats = parlay.legs?.map((l) => l.stat?.toUpperCase()).join("/") || "—";

  const edgeLift =
    parlay.true_hit_prob && parlay.base_hit_prob
      ? ((parlay.true_hit_prob - parlay.base_hit_prob) / parlay.base_hit_prob) * 100
      : 0;

  return (
    <>
      <TableRow
        className={`cursor-pointer transition-all ${ROW_STYLES[rec] || ROW_STYLES.SKIP}`}
        onClick={() => setOpen(!open)}
      >
        {/* Expand chevron + players */}
        <TableCell className="font-mono text-white">
          <div className="flex items-center gap-1.5">
            {open ? (
              <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
            )}
            <span className="truncate max-w-[220px]">{playerNames}</span>
          </div>
          <div className="ml-5 text-[10px] text-gray-500 font-mono">{stats}</div>
        </TableCell>

        {/* Template */}
        <TableCell>
          <Badge
            variant="outline"
            className={`text-[10px] ${TEMPLATE_COLORS[parlay.parlay_template as ParlayTemplate] || "text-gray-400 border-gray-500/30"}`}
          >
            {TEMPLATE_LABELS[parlay.parlay_template as ParlayTemplate] || parlay.parlay_template}
          </Badge>
        </TableCell>

        {/* Legs */}
        <TableCell className="font-mono text-gray-300 text-center">
          {parlay.leg_count}
        </TableCell>

        {/* Base vs True hit prob */}
        <TableCell className="font-mono text-gray-400">
          {fmt(parlay.base_hit_prob * 100, 1)}%
          <span className="text-[10px] text-gray-600 ml-1">base</span>
        </TableCell>
        <TableCell className="font-mono text-[#00ffc8]">
          {fmt(parlay.true_hit_prob * 100, 1)}%
          {edgeLift > 0 && (
            <span className="text-[10px] text-green-400 ml-1">
              +{fmt(edgeLift, 1)}%
            </span>
          )}
        </TableCell>

        {/* Payout */}
        <TableCell className="font-mono text-gray-300">
          {parlay.payout}x
        </TableCell>

        {/* Combined EV */}
        <TableCell className={`font-mono font-bold ${evColor(parlay.combined_ev)}`}>
          {parlay.combined_ev >= 0 ? "+" : ""}
          {fmt(parlay.combined_ev * 100, 1)}%
        </TableCell>

        {/* Recommendation */}
        <TableCell>
          <Badge
            variant="outline"
            className={`text-xs ${RECOMMENDATION_STYLES[rec] || RECOMMENDATION_STYLES.SKIP}`}
          >
            {rec}
          </Badge>
        </TableCell>

        {/* Outcome */}
        <TableCell className="font-mono text-xs">
          {parlay.outcome === true ? (
            <span className="text-[#00ffc8]">HIT</span>
          ) : parlay.outcome === false ? (
            <span className="text-rose-400">MISS</span>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded details */}
      {open && (
        <TableRow className="bg-black/30">
          <TableCell colSpan={9} className="p-0">
            <div className="px-6 py-4 space-y-4">
              {/* Avoid reason */}
              {parlay.avoid_reason && (
                <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2 font-mono">
                  AVOID: {parlay.avoid_reason}
                </div>
              )}

              {/* Legs table */}
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Legs
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-gray-600 uppercase">
                      <th className="text-left px-3 py-1">Player</th>
                      <th className="text-left px-2 py-1">Team</th>
                      <th className="text-left px-2 py-1">Stat</th>
                      <th className="text-left px-2 py-1">Line</th>
                      <th className="text-left px-2 py-1">Proj</th>
                      <th className="text-left px-2 py-1">Dir</th>
                      <th className="text-left px-2 py-1">Edge</th>
                      <th className="text-left px-2 py-1">Hit%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parlay.legs?.map((leg, i) => (
                      <LegRow key={i} leg={leg} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Correlations */}
              {parlay.correlations && parlay.correlations.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                    Pairwise Correlations
                  </div>
                  <div className="space-y-1.5">
                    {parlay.correlations.map((cd, i) => (
                      <div key={i} className="flex items-center gap-4 text-xs">
                        <span className="font-mono text-gray-300 min-w-[260px]">
                          {Array.isArray(cd.pair) ? cd.pair.join(" ↔ ") : "—"}
                        </span>
                        <span className="text-gray-600 font-mono text-[10px] uppercase">
                          {cd.stat}
                        </span>
                        <CorrBar corr={cd.correlation} />
                        <span className="font-mono text-[10px] text-gray-500">
                          {cd.relationship?.replace(/_/g, " ")}
                        </span>
                        <span className={`font-mono text-[10px] ${cd.ev_adjustment > 0 ? "text-green-400" : "text-rose-400"}`}>
                          EV {cd.ev_adjustment >= 0 ? "+" : ""}
                          {fmt(cd.ev_adjustment * 100, 2)}%
                        </span>
                        {cd.same_team && (
                          <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">
                            Same Team
                          </Badge>
                        )}
                        {cd.same_game && (
                          <Badge variant="outline" className="text-[9px] text-purple-400 border-purple-400/30">
                            Same Game
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* EV breakdown */}
              <div className="flex gap-8 text-xs font-mono text-gray-500">
                <span>
                  Base Hit: <span className="text-gray-300">{fmt(parlay.base_hit_prob * 100, 2)}%</span>
                </span>
                <span>
                  Corr-Adj Hit: <span className="text-[#00ffc8]">{fmt(parlay.true_hit_prob * 100, 2)}%</span>
                </span>
                <span>
                  Payout: <span className="text-gray-300">{parlay.payout}x</span>
                </span>
                <span>
                  Combined EV:{" "}
                  <span className={evColor(parlay.combined_ev)}>
                    {parlay.combined_ev >= 0 ? "+" : ""}
                    {fmt(parlay.combined_ev * 100, 2)}%
                  </span>
                </span>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ParlayCorrelationPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [parlaySize, setParlaySize] = useState<number>(2);
  const [showAvoid, setShowAvoid] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<ParlaysResponse>({
    queryKey: ["/api/parlays", date, parlaySize],
    queryFn: () =>
      apiRequest(
        `/api/parlays?date=${date}&size=${parlaySize}&min_ev=-1&limit=50`
      ),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/parlays/generate", {
        method: "POST",
        body: JSON.stringify({ date, parlay_size: parlaySize }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
    },
  });

  const parlays = data?.parlays ?? [];
  const visible = showAvoid
    ? parlays
    : parlays.filter((p) => p.recommendation !== "AVOID" && p.recommendation !== "SKIP");

  const smashCount = parlays.filter((p) => p.recommendation === "SMASH").length;
  const strongCount = parlays.filter((p) => p.recommendation === "STRONG").length;
  const leanCount = parlays.filter((p) => p.recommendation === "LEAN").length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-[#00ffc8]" />
            Correlated Parlay Detection
          </h1>
          <p className="text-gray-500 text-sm mt-1 font-mono">
            PrizePicks prices legs as independent — they are not. Exploit
            pairwise correlations for hidden +EV stacks.
          </p>
        </div>

        {/* Summary badges */}
        <div className="flex gap-2">
          <Badge variant="outline" className="text-[#00ffc8] border-[#00ffc8]/40 font-mono">
            {smashCount} SMASH
          </Badge>
          <Badge variant="outline" className="text-green-400 border-green-400/40 font-mono">
            {strongCount} STRONG
          </Badge>
          <Badge variant="outline" className="text-yellow-400 border-yellow-400/40 font-mono">
            {leanCount} LEAN
          </Badge>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Date picker */}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-[#00ffc8]/50"
        />

        {/* Leg count selector */}
        <div className="flex gap-1">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setParlaySize(n)}
              className={`px-3 py-1.5 rounded text-sm font-mono border transition-all ${
                parlaySize === n
                  ? "bg-[#00ffc8]/10 border-[#00ffc8]/50 text-[#00ffc8]"
                  : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"
              }`}
            >
              {n}-Leg
            </button>
          ))}
        </div>

        {/* Show/hide avoid */}
        <button
          onClick={() => setShowAvoid(!showAvoid)}
          className={`px-3 py-1.5 rounded text-sm font-mono border transition-all ${
            showAvoid
              ? "bg-rose-500/10 border-rose-500/40 text-rose-400"
              : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"
          }`}
        >
          {showAvoid ? "Hide" : "Show"} AVOID/SKIP
        </button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="font-mono text-gray-300 border-white/10 hover:border-[#00ffc8]/40"
        >
          <RefreshCw className={`w-3 h-3 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>

        <Button
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="font-mono bg-[#00ffc8]/10 text-[#00ffc8] border border-[#00ffc8]/30 hover:bg-[#00ffc8]/20"
        >
          <Zap className={`w-3 h-3 mr-1.5 ${generateMutation.isPending ? "animate-pulse" : ""}`} />
          {generateMutation.isPending ? "Generating…" : "Generate"}
        </Button>
      </div>

      {/* Template legend */}
      <div className="flex gap-4 mb-4 text-[10px] font-mono text-gray-600">
        {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
          <span
            key={key}
            className={TEMPLATE_COLORS[key as ParlayTemplate] || "text-gray-600"}
          >
            {label}
          </span>
        ))}
        <span className="ml-2 text-gray-700">|</span>
        <span className="text-gray-600">
          Correlation bar: <span className="text-[#00ffc8]">■</span> positive{" "}
          <span className="text-rose-500">■</span> negative
        </span>
      </div>

      {/* Error from generate */}
      {generateMutation.isError && (
        <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2 font-mono">
          Generation failed:{" "}
          {(generateMutation.error as any)?.message || "Unknown error"}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-20 text-gray-600 font-mono animate-pulse">
          Loading parlays…
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 text-gray-600 font-mono">
          <div className="text-4xl mb-3 opacity-20">◈</div>
          No parlay recommendations found for {date} ({parlaySize}-leg).
          <br />
          <span className="text-xs">
            Click <strong>Generate</strong> to run the parlay builder.
          </span>
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  Players / Stats
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  Template
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase text-center">
                  Legs
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  Base Hit%
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  True Hit%
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  Payout
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  EV
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  Rec
                </TableHead>
                <TableHead className="font-mono text-gray-500 text-xs uppercase">
                  Result
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((parlay) => (
                <ParlayRow key={parlay.id} parlay={parlay} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 text-[10px] text-gray-700 font-mono">
        Showing {visible.length} of {parlays.length} parlays for {date}.{" "}
        EV = (true_hit_prob × payout) − 1. Correlation adjustment = Σ(r × 0.08) per pair.
      </div>
    </div>
  );
}
