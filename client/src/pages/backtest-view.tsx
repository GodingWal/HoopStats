import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlaskConical, TrendingUp, TrendingDown } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DailyRow {
  game_date: string;
  signal_type: string;
  plays: number;
  wins: number;
  hit_rate: number;
  avg_clv: number;
  daily_units: number;
  cumulative_units: number;
}

interface SummaryRow {
  signal_type: string;
  total_plays: number;
  hit_rate: number;
  avg_clv: number;
  total_units: number;
}

interface BacktestData {
  daily: DailyRow[];
  by_signal: Record<string, DailyRow[]>;
  summary: SummaryRow[];
  signal: string | null;
  days: number;
  cached: boolean;
  cache_age?: number;
}

// ─── Colors for each signal ──────────────────────────────────────────────────

const SIGNAL_COLORS = [
  "#00ffc8",
  "#86efac",
  "#fde68a",
  "#f9a8d4",
  "#93c5fd",
  "#c4b5fd",
  "#fb923c",
  "#34d399",
  "#f472b6",
  "#a78bfa",
];

function getColor(idx: number): string {
  return SIGNAL_COLORS[idx % SIGNAL_COLORS.length];
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-white/20 rounded-lg p-3 text-xs font-mono shadow-xl">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white font-semibold">
            {p.value >= 0 ? "+" : ""}
            {Number(p.value).toFixed(2)} u
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Summary card ────────────────────────────────────────────────────────────

function SummaryCard({ row, idx }: { row: SummaryRow; idx: number }) {
  const color = getColor(idx);
  const positive = Number(row.total_units) >= 0;
  const hitPct = (Number(row.hit_rate) * 100).toFixed(1);
  const roi = row.total_plays
    ? ((Number(row.total_units) / row.total_plays) * 100).toFixed(1)
    : "—";

  return (
    <div
      className="rounded-lg border p-4 space-y-2 transition-all hover:scale-[1.01]"
      style={{ borderColor: `${color}30`, background: `${color}08` }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono font-semibold text-sm text-white">
          {row.signal_type.replace(/_/g, " ")}
        </span>
        {positive ? (
          <TrendingUp className="w-4 h-4" style={{ color }} />
        ) : (
          <TrendingDown className="w-4 h-4 text-rose-400" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div>
          <p className="text-gray-500">Total Plays</p>
          <p className="text-white">{row.total_plays}</p>
        </div>
        <div>
          <p className="text-gray-500">Hit Rate</p>
          <p style={{ color }}>{hitPct}%</p>
        </div>
        <div>
          <p className="text-gray-500">Avg CLV</p>
          <p className={Number(row.avg_clv) >= 0 ? "text-green-400" : "text-rose-400"}>
            {Number(row.avg_clv) >= 0 ? "+" : ""}
            {Number(row.avg_clv).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Total Units</p>
          <p
            className={positive ? "text-[#00ffc8] font-bold" : "text-rose-400 font-bold"}
          >
            {positive ? "+" : ""}
            {Number(row.total_units).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="border-t border-white/10 pt-2 text-xs font-mono">
        <span className="text-gray-500">ROI: </span>
        <span className={positive ? "text-[#00ffc8]" : "text-rose-400"}>
          {positive ? "+" : ""}
          {roi}%
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const DAY_OPTIONS = [30, 60, 90, 180];

export default function BacktestView() {
  const [days, setDays] = useState(90);
  const [activeSignals, setActiveSignals] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery<BacktestData>({
    queryKey: ["/api/backtest", days],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/backtest?days=${days}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const signalTypes = Object.keys(data?.by_signal ?? {});

  // Initialize active set when data loads
  if (data && activeSignals.size === 0 && signalTypes.length > 0) {
    setActiveSignals(new Set(signalTypes));
  }

  function toggleSignal(s: string) {
    setActiveSignals((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  // Build chart data: merge all signal daily rows into unified date series
  const allDates = Array.from(
    new Set(data?.daily.map((r) => r.game_date) ?? [])
  ).sort();

  const chartData = allDates.map((date) => {
    const point: Record<string, any> = { date };
    for (const sig of signalTypes) {
      if (!activeSignals.has(sig)) continue;
      const row = data?.by_signal[sig]?.find((r) => r.game_date === date);
      point[sig] = row ? row.cumulative_units : null;
    }
    return point;
  });

  const summary = data?.summary ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono text-[#00ffc8] flex items-center gap-2">
            <FlaskConical className="w-6 h-6" />
            Backtest Lab
          </h1>
          <p className="text-sm text-gray-400 font-mono mt-1">
            Cumulative ROI by signal type
            {data?.cached && (
              <span className="ml-2 text-yellow-500/70">
                (cached {data.cache_age}s ago)
              </span>
            )}
          </p>
        </div>

        {/* Day selector */}
        <div className="flex gap-1">
          {DAY_OPTIONS.map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setDays(d);
                setActiveSignals(new Set());
              }}
              className={`font-mono text-xs ${
                days === d
                  ? "bg-[#00ffc8] text-black hover:bg-[#00ffc8]/90"
                  : "border-white/20 text-gray-400"
              }`}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-gray-400 font-mono">
          <FlaskConical className="w-6 h-6 mx-auto mb-3 animate-pulse text-[#00ffc8]" />
          Loading backtest data...
        </div>
      ) : error ? (
        <div className="text-center py-20 text-rose-400 font-mono">
          Error loading backtest data.
        </div>
      ) : (
        <>
          {/* Signal toggles */}
          {signalTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {signalTypes.map((sig, idx) => {
                const color = getColor(idx);
                const active = activeSignals.has(sig);
                return (
                  <button
                    key={sig}
                    onClick={() => toggleSignal(sig)}
                    className={`px-3 py-1 rounded-full text-xs font-mono border transition-all ${
                      active ? "opacity-100" : "opacity-30"
                    }`}
                    style={{
                      borderColor: color,
                      color: active ? color : "gray",
                      backgroundColor: active ? `${color}15` : "transparent",
                    }}
                  >
                    {sig.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          )}

          {/* Chart */}
          {chartData.length > 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-mono text-gray-500 mb-4 uppercase tracking-wider">
                Cumulative Units Won/Lost
              </p>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }}
                    tickFormatter={(v) => v.slice(5)} // MM-DD
                  />
                  <YAxis
                    tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }}
                    tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}u`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }}
                    formatter={(v) => v.replace(/_/g, " ")}
                  />
                  {/* Zero line */}
                  <Line
                    type="monotone"
                    dataKey={() => 0}
                    stroke="rgba(255,255,255,0.15)"
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                    name="break-even"
                  />
                  {signalTypes
                    .filter((s) => activeSignals.has(s))
                    .map((sig, idx) => (
                      <Line
                        key={sig}
                        type="monotone"
                        dataKey={sig}
                        stroke={getColor(idx)}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-16 text-gray-500 font-mono rounded-lg border border-white/10">
              No backtest data yet. Signal results will appear after games are resolved.
            </div>
          )}

          {/* Summary cards */}
          {summary.length > 0 && (
            <>
              <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">
                Summary — Last {days} Days
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {summary.map((row, idx) => (
                  <SummaryCard key={row.signal_type} row={row} idx={idx} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
