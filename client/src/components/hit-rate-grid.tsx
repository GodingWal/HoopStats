import type { HitRates } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

interface HitRateGridProps {
  hitRates: HitRates;
  stat: string;
}

function getHitRateColor(rate: number): string {
  if (rate >= 80) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (rate >= 60) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (rate >= 40) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function getBarWidth(rate: number): string {
  return `${Math.min(rate, 100)}%`;
}

export function HitRateGrid({ hitRates, stat }: HitRateGridProps) {
  const lines = hitRates[stat];
  
  if (!lines) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        No hit rate data available for {stat}
      </div>
    );
  }

  const sortedLines = Object.entries(lines).sort(
    (a, b) => parseFloat(a[0]) - parseFloat(b[0])
  );

  return (
    <div className="space-y-2">
      {sortedLines.map(([line, rate]) => (
        <div key={line} className="flex items-center gap-3" data-testid={`hitrate-${stat}-${line}`}>
          <div className="w-12 text-xs font-mono text-muted-foreground text-right">
            O{line}
          </div>
          <div className="flex-1 h-6 bg-muted/30 rounded-sm overflow-hidden relative">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                rate >= 80 ? "bg-emerald-500/40" :
                rate >= 60 ? "bg-yellow-500/40" :
                rate >= 40 ? "bg-orange-500/40" :
                "bg-red-500/40"
              }`}
              style={{ width: getBarWidth(rate) }}
            />
            <div className="absolute inset-0 flex items-center justify-end pr-2">
              <span className={`text-xs font-mono font-semibold ${
                rate >= 80 ? "text-emerald-400" :
                rate >= 60 ? "text-yellow-400" :
                rate >= 40 ? "text-orange-400" :
                "text-red-400"
              }`}>
                {rate.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface HitRateSummaryProps {
  hitRates: HitRates;
}

export function HitRateSummary({ hitRates }: HitRateSummaryProps) {
  const stats = ["PTS", "REB", "AST", "PRA", "FG3M"];
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {stats.map((stat) => {
        const lines = hitRates[stat];
        if (!lines) return null;
        
        const entries = Object.entries(lines);
        const bestLine = entries.find(([_, rate]) => rate >= 70);
        
        return (
          <div key={stat} className="bg-muted/20 rounded-md p-3 border border-border">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              {stat}
            </div>
            {bestLine ? (
              <>
                <div className="text-lg font-mono font-semibold">O{bestLine[0]}</div>
                <Badge 
                  variant="secondary" 
                  className={`mt-1 text-[10px] ${getHitRateColor(bestLine[1])}`}
                >
                  {bestLine[1].toFixed(0)}% hit
                </Badge>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">No high-hit lines</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
