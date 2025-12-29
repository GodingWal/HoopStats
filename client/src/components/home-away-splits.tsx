import type { SplitAverages } from "@shared/schema";
import { Home, Plane } from "lucide-react";

interface HomeAwaySplitsProps {
  homeAverages: SplitAverages;
  awayAverages: SplitAverages;
}

function StatComparison({
  label,
  home,
  away,
}: {
  label: string;
  home: number;
  away: number;
}) {
  const diff = home - away;
  const homeHigher = diff > 0;

  return (
    <div className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground w-12">{label}</span>
      <div className="flex items-center gap-6">
        <span className={`font-mono font-semibold w-10 text-right ${homeHigher ? "text-emerald-400" : ""}`}>
          {home.toFixed(1)}
        </span>
        <span className={`font-mono font-semibold w-10 text-right ${!homeHigher ? "text-emerald-400" : ""}`}>
          {away.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

export function HomeAwaySplits({ homeAverages, awayAverages }: HomeAwaySplitsProps) {
  return (
    <div className="bg-muted/20 rounded-md border border-border">
      <div className="flex items-center border-b border-border px-3 py-2">
        <div className="flex-1 text-xs text-muted-foreground"></div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5 w-10 justify-end">
            <Home className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Home</span>
          </div>
          <div className="flex items-center gap-1.5 w-10 justify-end">
            <Plane className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Away</span>
          </div>
        </div>
      </div>
      <div className="px-3 py-1">
        <StatComparison label="PTS" home={homeAverages.PTS} away={awayAverages.PTS} />
        <StatComparison label="REB" home={homeAverages.REB} away={awayAverages.REB} />
        <StatComparison label="AST" home={homeAverages.AST} away={awayAverages.AST} />
        <StatComparison label="PRA" home={homeAverages.PRA} away={awayAverages.PRA} />
      </div>
    </div>
  );
}
