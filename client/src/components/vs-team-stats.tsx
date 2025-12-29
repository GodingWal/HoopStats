import type { VsTeamStats as VsTeamStatsType } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

interface VsTeamStatsProps {
  vsTeam: Record<string, VsTeamStatsType>;
  seasonAvg: {
    PTS: number;
    REB: number;
    AST: number;
    PRA: number;
  };
}

function getDiffIndicator(value: number, avg: number): { text: string; color: string } {
  const diff = value - avg;
  const pctDiff = (diff / avg) * 100;
  
  if (pctDiff > 10) return { text: `+${diff.toFixed(1)}`, color: "text-emerald-400" };
  if (pctDiff < -10) return { text: diff.toFixed(1), color: "text-red-400" };
  return { text: "~", color: "text-muted-foreground" };
}

export function VsTeamStats({ vsTeam, seasonAvg }: VsTeamStatsProps) {
  const teams = Object.entries(vsTeam).sort((a, b) => b[1].PRA - a[1].PRA);

  if (teams.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        No matchup data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {teams.slice(0, 5).map(([team, stats]) => {
        const ptsDiff = getDiffIndicator(stats.PTS, seasonAvg.PTS);
        const rebDiff = getDiffIndicator(stats.REB, seasonAvg.REB);
        const astDiff = getDiffIndicator(stats.AST, seasonAvg.AST);
        const praDiff = getDiffIndicator(stats.PRA, seasonAvg.PRA);

        return (
          <div 
            key={team} 
            className="bg-muted/20 rounded-md p-3 border border-border"
            data-testid={`vs-team-${team}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">vs {team}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {stats.games} {stats.games === 1 ? "game" : "games"}
                </Badge>
              </div>
              <div className={`text-sm font-mono font-semibold ${praDiff.color}`}>
                {stats.PRA.toFixed(1)} PRA
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="text-center">
                <div className="text-muted-foreground mb-0.5">PTS</div>
                <div className="font-mono font-semibold">{stats.PTS.toFixed(1)}</div>
                <div className={`text-[10px] ${ptsDiff.color}`}>{ptsDiff.text}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground mb-0.5">REB</div>
                <div className="font-mono font-semibold">{stats.REB.toFixed(1)}</div>
                <div className={`text-[10px] ${rebDiff.color}`}>{rebDiff.text}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground mb-0.5">AST</div>
                <div className="font-mono font-semibold">{stats.AST.toFixed(1)}</div>
                <div className={`text-[10px] ${astDiff.color}`}>{astDiff.text}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground mb-0.5">3PM</div>
                <div className="font-mono font-semibold">{stats.FG3M?.toFixed(1) ?? "-"}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
