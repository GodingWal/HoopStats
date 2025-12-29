import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatBadgeProps {
  label: string;
  value: number | string;
  hitRate?: number;
  trend?: number;
  size?: "sm" | "md" | "lg";
}

function getHitRateColor(rate: number): string {
  if (rate >= 80) return "text-emerald-400";
  if (rate >= 60) return "text-yellow-400";
  if (rate >= 40) return "text-orange-400";
  return "text-red-400";
}

function getHitRateBg(rate: number): string {
  if (rate >= 80) return "bg-emerald-500/10 border-emerald-500/20";
  if (rate >= 60) return "bg-yellow-500/10 border-yellow-500/20";
  if (rate >= 40) return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export function StatBadge({ label, value, hitRate, trend, size = "md" }: StatBadgeProps) {
  const sizeClasses = {
    sm: "px-2 py-1.5 min-w-[60px]",
    md: "px-3 py-2 min-w-[80px]",
    lg: "px-4 py-3 min-w-[100px]",
  };

  const valueSizes = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-2xl",
  };

  const labelSizes = {
    sm: "text-[9px]",
    md: "text-[10px]",
    lg: "text-xs",
  };

  return (
    <div
      className={`
        rounded-md border text-center
        ${sizeClasses[size]}
        ${hitRate !== undefined ? getHitRateBg(hitRate) : "bg-muted/30 border-border"}
      `}
    >
      <div
        className={`
          uppercase tracking-wider text-muted-foreground mb-1
          ${labelSizes[size]}
        `}
      >
        {label}
      </div>
      <div className={`font-mono font-semibold ${valueSizes[size]} flex items-center justify-center gap-1`}>
        <span>{typeof value === "number" ? value.toFixed(1) : value}</span>
        {trend !== undefined && (
          <span className="inline-flex">
            {trend > 0 && <TrendingUp className="w-3 h-3 text-emerald-400" />}
            {trend < 0 && <TrendingDown className="w-3 h-3 text-red-400" />}
            {trend === 0 && <Minus className="w-3 h-3 text-muted-foreground" />}
          </span>
        )}
      </div>
      {hitRate !== undefined && (
        <div className={`text-[10px] mt-0.5 ${getHitRateColor(hitRate)}`}>
          {hitRate.toFixed(0)}% hit
        </div>
      )}
    </div>
  );
}

interface StatBadgeGroupProps {
  stats: Array<{
    label: string;
    value: number;
    hitRate?: number;
    trend?: number;
  }>;
  size?: "sm" | "md" | "lg";
}

export function StatBadgeGroup({ stats, size = "md" }: StatBadgeGroupProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {stats.map((stat) => (
        <StatBadge
          key={stat.label}
          label={stat.label}
          value={stat.value}
          hitRate={stat.hitRate}
          trend={stat.trend}
          size={size}
        />
      ))}
    </div>
  );
}
