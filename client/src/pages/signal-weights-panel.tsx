import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface WeightEntry {
  signal_type: string;
  weight: number;
  hit_rate: number;
  clv_rate: number;
  sample_size: number;
  updated_at: string;
}

function SparkBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color =
    value > 0.6 ? "#00ffc8" : value > 0.5 ? "#86efac" : value > 0.4 ? "#fde68a" : "#f87171";
  return (
    <div className="w-20 h-2 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function WeightTrend({ weight }: { weight: number }) {
  if (weight > 0.6)
    return <TrendingUp className="w-3.5 h-3.5 text-[#00ffc8]" />;
  if (weight < 0.4)
    return <TrendingDown className="w-3.5 h-3.5 text-rose-400" />;
  return <Minus className="w-3.5 h-3.5 text-gray-500" />;
}

function signalLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sampleBadge(n: number): string {
  if (n >= 200) return "bg-[#00ffc8]/10 text-[#00ffc8] border-[#00ffc8]/30";
  if (n >= 50) return "bg-green-400/10 text-green-400 border-green-400/30";
  if (n >= 20) return "bg-yellow-400/10 text-yellow-400 border-yellow-400/30";
  return "bg-gray-500/10 text-gray-400 border-gray-500/30";
}

function fmt(val: number | null | undefined, decimals = 3): string {
  if (val == null) return "—";
  return Number(val).toFixed(decimals);
}

function pct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(Number(val) * 100).toFixed(1)}%`;
}

export default function SignalWeightsPanel() {
  const { data, isLoading, error } = useQuery<{
    weights: WeightEntry[];
    cached: boolean;
    cache_age?: number;
  }>({
    queryKey: ["/api/signals/weights"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/signals/weights");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const weights = data?.weights ?? [];
  const maxWeight = Math.max(...weights.map((w) => Number(w.weight)), 1);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-mono text-[#00ffc8] flex items-center gap-2">
          <Activity className="w-6 h-6" />
          Signal Weights
        </h1>
        <p className="text-sm text-gray-400 font-mono mt-1">
          Bayesian weight registry · updated weekly via Thompson Sampling
          {data?.cached && (
            <span className="ml-2 text-yellow-500/70">
              (cached {data.cache_age}s ago)
            </span>
          )}
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-gray-400 font-mono">
          <Activity className="w-6 h-6 mx-auto mb-3 animate-pulse text-[#00ffc8]" />
          Loading weights...
        </div>
      ) : error ? (
        <div className="text-center py-20 text-rose-400 font-mono">
          Error loading weights.
        </div>
      ) : weights.length === 0 ? (
        <div className="text-center py-20 text-gray-500 font-mono">
          No weight data yet. Run the Bayesian optimizer to populate.
        </div>
      ) : (
        <div className="space-y-2">
          {weights.map((entry, idx) => (
            <div
              key={entry.signal_type}
              className="rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition-colors"
            >
              <div className="flex items-center gap-4">
                {/* Rank */}
                <span className="text-xs font-mono text-gray-600 w-5 text-right">
                  #{idx + 1}
                </span>

                {/* Signal name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <WeightTrend weight={Number(entry.weight)} />
                    <span className="font-mono font-semibold text-white text-sm">
                      {signalLabel(entry.signal_type)}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-gray-500 mt-0.5">
                    {entry.signal_type}
                  </p>
                </div>

                {/* Weight bar */}
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-2">
                    <SparkBar value={Number(entry.weight)} max={maxWeight} />
                    <span className="font-mono font-bold text-sm text-white w-12 text-right">
                      {fmt(entry.weight)}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">weight</span>
                </div>

                {/* Hit rate */}
                <div className="text-right w-20">
                  <p className="font-mono text-sm text-green-400">
                    {pct(entry.hit_rate)}
                  </p>
                  <p className="text-xs text-gray-500 font-mono">hit rate</p>
                </div>

                {/* CLV rate */}
                <div className="text-right w-20">
                  <p className="font-mono text-sm text-[#00ffc8]">
                    {pct(entry.clv_rate)}
                  </p>
                  <p className="text-xs text-gray-500 font-mono">CLV rate</p>
                </div>

                {/* Sample size */}
                <div className="text-right">
                  <Badge
                    className={`font-mono text-xs ${sampleBadge(Number(entry.sample_size))}`}
                  >
                    n={entry.sample_size}
                  </Badge>
                </div>
              </div>

              {/* Last updated */}
              <p className="text-xs text-gray-600 font-mono mt-2 text-right">
                Updated:{" "}
                {entry.updated_at
                  ? new Date(entry.updated_at).toLocaleDateString()
                  : "never"}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs font-mono text-gray-500 mb-3 uppercase tracking-wider">
          Weight Formula
        </p>
        <p className="font-mono text-sm text-gray-300">
          weight = (hit_rate × 0.6) + (clv_rate_normalized × 0.4)
        </p>
        <p className="font-mono text-xs text-gray-500 mt-1">
          Thompson Sampling dampening applied · requires n≥20 for meaningful adjustment
        </p>
        <div className="flex gap-4 mt-3 text-xs font-mono">
          <span>
            <span className="text-[#00ffc8]">■</span> n≥200 (high confidence)
          </span>
          <span>
            <span className="text-green-400">■</span> n≥50
          </span>
          <span>
            <span className="text-yellow-400">■</span> n≥20
          </span>
          <span>
            <span className="text-gray-500">■</span> n&lt;20 (prior-dominated)
          </span>
        </div>
      </div>
    </div>
  );
}
