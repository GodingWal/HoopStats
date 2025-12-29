import type { Player } from "@shared/schema";
import { Sparkline } from "./sparkline";
import { Badge } from "@/components/ui/badge";

interface PlayerCardProps {
  player: Player;
  isSelected?: boolean;
  onClick?: () => void;
}

export function PlayerCard({ player, isSelected, onClick }: PlayerCardProps) {
  const recentPts = player.recent_games.map((g) => g.PTS).reverse();
  const avgPts = player.season_averages.PTS;
  const lastPts = player.recent_games[0]?.PTS ?? 0;
  const ptsTrend = lastPts - avgPts;

  return (
    <div
      onClick={onClick}
      data-testid={`player-card-${player.player_id}`}
      className={`
        p-3 rounded-md cursor-pointer transition-colors
        ${isSelected 
          ? "bg-primary/10 border border-primary/30" 
          : "bg-card border border-transparent hover-elevate"
        }
      `}
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground flex-shrink-0">
          {player.player_name.split(" ").map(n => n[0]).join("")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm truncate">{player.player_name}</h3>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {player.team}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-1.5">
            <div className="text-xs">
              <span className="text-muted-foreground">PTS </span>
              <span className="font-mono font-semibold">{avgPts.toFixed(1)}</span>
              {ptsTrend !== 0 && (
                <span className={`ml-1 text-[10px] ${ptsTrend > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {ptsTrend > 0 ? "+" : ""}{ptsTrend.toFixed(1)}
                </span>
              )}
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">REB </span>
              <span className="font-mono font-semibold">{player.season_averages.REB.toFixed(1)}</span>
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">AST </span>
              <span className="font-mono font-semibold">{player.season_averages.AST.toFixed(1)}</span>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          <Sparkline data={recentPts} width={60} height={20} />
        </div>
      </div>
    </div>
  );
}
