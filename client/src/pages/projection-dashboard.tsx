import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { ChevronDown, ChevronRight, RefreshCw, Zap } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ConfidenceTier = "SMASH" | "STRONG" | "LEAN" | "SKIP";

interface SignalFired {
  signal_name: string;
  direction: "OVER" | "UNDER" | null;
  adjustment: number;
  confidence: number;
  weight: number;
  weighted_contribution: number;
  metadata?: Record<string, any>;
}

interface Projection {
  id: number;
  player_id: string;
  player_name: string;
  game_date: string;
  prop_type: string;
  baseline_projection: number;
  signal_delta: number;
  final_projection: number;
  prizepicks_line: number;
  edge_pct: number;
  confidence_tier: ConfidenceTier;
  kelly_stake: number;
  signals_fired: SignalFired[];
  direction?: "OVER" | "UNDER" | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIER_STYLES: Record<ConfidenceTier, string> = {
  SMASH: "text-[#00ffc8] font-bold border-[#00ffc8]/50 bg-[#00ffc8]/10",
  STRONG: "text-green-400 font-semibold border-green-400/50 bg-green-400/10",
  LEAN: "text-yellow-400 font-medium border-yellow-400/50 bg-yellow-400/10",
  SKIP: "text-gray-500 border-gray-500/30 bg-gray-500/5",
};

const ROW_STYLES: Record<ConfidenceTier, string> = {
  SMASH: "border-l-2 border-l-[#00ffc8] bg-[#00ffc8]/5 hover:bg-[#00ffc8]/10",
  STRONG: "border-l-2 border-l-green-500 bg-green-500/5 hover:bg-green-500/10",
  LEAN: "border-l-2 border-l-yellow-500 bg-yellow-500/5 hover:bg-yellow-500/10",
  SKIP: "border-l-2 border-l-gray-600 opacity-50 hover:opacity-70",
};

function fmt(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return Number(val).toFixed(decimals);
}

function edgeColor(edge: number): string {
  if (Math.abs(edge) > 8) return "text-[#00ffc8]";
  if (Math.abs(edge) > 5) return "text-green-400";
  if (Math.abs(edge) > 3) return "text-yellow-400";
  return "text-gray-400";
}

// ─── Signal Row (expanded) ───────────────────────────────────────────────────

function SignalRow({ signal }: { signal: SignalFired }) {
  const dirColor =
    signal.direction === "OVER"
      ? "text-[#00ffc8]"
      : signal.direction === "UNDER"
      ? "text-rose-400"
      : "text-gray-400";

  return (
    <tr className="text-xs border-t border-white/5">
      <td className="py-1 px-3 font-mono text-gray-300">{signal.signal_name}</td>
      <td className={`py-1 px-2 font-mono ${dirColor}`}>
        {signal.direction ?? "—"}
      </td>
      <td className="py-1 px-2 font-mono text-gray-400">
        {signal.adjustment >= 0 ? "+" : ""}
        {fmt(signal.adjustment * 100, 1)}%
      </td>
      <td className="py-1 px-2 font-mono text-gray-400">
        {fmt(signal.confidence * 100, 0)}%
      </td>
      <td className="py-1 px-2 font-mono text-gray-400">
        {fmt(signal.weight, 3)}
      </td>
      <td className={`py-1 px-2 font-mono ${dirColor}`}>
        {signal.weighted_contribution >= 0 ? "+" : ""}
        {fmt(signal.weighted_contribution * 100, 1)}%
      </td>
    </tr>
  );
}

// ─── Projection Row ──────────────────────────────────────────────────────────

function ProjectionRow({ proj }: { proj: Projection }) {
  const [open, setOpen] = useState(false);
  const tier = (proj.confidence_tier as ConfidenceTier) || "SKIP";

  return (
    <>
      <TableRow
        className={`cursor-pointer transition-all ${ROW_STYLES[tier]}`}
        onClick={() => setOpen(!open)}
      >
        <TableCell className="font-mono text-white">
          <div className="flex items-center gap-1.5">
            {open ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )}
            {proj.player_name || proj.player_id}
          </div>
        </TableCell>
        <TableCell className="font-mono text-gray-300">{proj.prop_type}</TableCell>
        <TableCell className="font-mono text-gray-300">{fmt(proj.prizepicks_line)}</TableCell>
        <TableCell className="font-mono text-[#00ffc8]">{fmt(proj.final_projection)}</TableCell>
        <TableCell className={`font-mono font-bold ${edgeColor(proj.edge_pct)}`}>
          {proj.edge_pct >= 0 ? "+" : ""}
          {fmt(proj.edge_pct, 1)}%
        </TableCell>
        <TableCell>
          <Badge className={`font-mono text-xs ${TIER_STYLES[tier]}`}>
            {tier}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-gray-300">
          {fmt(proj.kelly_stake * 100, 1)}%
        </TableCell>
        <TableCell className="font-mono text-gray-400">
          {Array.isArray(proj.signals_fired)
            ? proj.signals_fired.length
            : 0}
        </TableCell>
      </TableRow>

      {open && Array.isArray(proj.signals_fired) && proj.signals_fired.length > 0 && (
        <TableRow className="bg-black/30">
          <TableCell colSpan={8} className="p-0">
            <div className="px-6 py-3">
              <p className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-wider">
                Signals Fired
              </p>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 font-mono">
                    <th className="text-left px-3 py-1">Signal</th>
                    <th className="text-left px-2 py-1">Dir</th>
                    <th className="text-left px-2 py-1">Adj%</th>
                    <th className="text-left px-2 py-1">Conf</th>
                    <th className="text-left px-2 py-1">Weight</th>
                    <th className="text-left px-2 py-1">Contrib%</th>
                  </tr>
                </thead>
                <tbody>
                  {proj.signals_fired.map((s, i) => (
                    <SignalRow key={i} signal={s} />
                  ))}
                </tbody>
              </table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type FilterTier = "ALL" | ConfidenceTier;
const FILTERS: FilterTier[] = ["ALL", "SMASH", "STRONG", "LEAN"];

export default function ProjectionDashboard() {
  const [filter, setFilter] = useState<FilterTier>("ALL");
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading, error, refetch, isFetching } = useQuery<{
    projections: Projection[];
    cached: boolean;
    cache_age?: number;
  }>({
    queryKey: ["/api/projections/today", today],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projections/today?date=${today}`);
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  const projections = data?.projections ?? [];
  const filtered =
    filter === "ALL"
      ? projections
      : projections.filter((p) => p.confidence_tier === filter);

  const smashCount = projections.filter((p) => p.confidence_tier === "SMASH").length;
  const strongCount = projections.filter((p) => p.confidence_tier === "STRONG").length;
  const leanCount = projections.filter((p) => p.confidence_tier === "LEAN").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono text-[#00ffc8]">
            Projection Dashboard
          </h1>
          <p className="text-sm text-gray-400 font-mono mt-1">
            {today} · {projections.length} projections
            {data?.cached && (
              <span className="ml-2 text-yellow-500/70">
                (cached {data.cache_age}s ago)
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="font-mono border-[#00ffc8]/30 text-[#00ffc8] hover:bg-[#00ffc8]/10"
        >
          {isFetching ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "SMASH", count: smashCount, color: "text-[#00ffc8]", bg: "bg-[#00ffc8]/10" },
          { label: "STRONG", count: strongCount, color: "text-green-400", bg: "bg-green-400/10" },
          { label: "LEAN", count: leanCount, color: "text-yellow-400", bg: "bg-yellow-400/10" },
          { label: "TOTAL", count: projections.length, color: "text-gray-300", bg: "bg-white/5" },
        ].map(({ label, count, color, bg }) => (
          <div
            key={label}
            className={`${bg} rounded-lg p-3 border border-white/10`}
          >
            <p className={`text-2xl font-bold font-mono ${color}`}>{count}</p>
            <p className="text-xs font-mono text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            className={`font-mono text-xs ${
              filter === f
                ? "bg-[#00ffc8] text-black hover:bg-[#00ffc8]/90"
                : "border-white/20 text-gray-400 hover:border-[#00ffc8]/50"
            }`}
          >
            {f}
          </Button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-20 text-gray-400 font-mono">
          <Zap className="w-6 h-6 mx-auto mb-3 animate-pulse text-[#00ffc8]" />
          Loading projections...
        </div>
      ) : error ? (
        <div className="text-center py-20 text-rose-400 font-mono">
          Error loading projections. Check server connection.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500 font-mono">
          No {filter !== "ALL" ? filter : ""} projections for today.
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-white/10 bg-white/5">
                {["Player", "Prop", "Line", "Model", "Edge%", "Tier", "Kelly", "Signals"].map(
                  (h) => (
                    <TableHead key={h} className="font-mono text-xs text-gray-400 uppercase">
                      {h}
                    </TableHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((proj) => (
                <ProjectionRow key={proj.id} proj={proj} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs font-mono text-gray-500">
        <span>
          <span className="text-[#00ffc8]">■</span> SMASH: 3+ signals, edge &gt;8%
        </span>
        <span>
          <span className="text-green-400">■</span> STRONG: 2+ signals, edge 5–8%
        </span>
        <span>
          <span className="text-yellow-400">■</span> LEAN: 1 signal, edge 3–5%
        </span>
        <span>
          <span className="text-gray-500">■</span> SKIP: conflict or edge &lt;3%
        </span>
      </div>
    </div>
  );
}
