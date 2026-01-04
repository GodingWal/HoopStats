import type { Player } from "@shared/schema";
import { Sparkline } from "./sparkline";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Star } from "lucide-react";

interface PlayerCardProps {
  player: Player;
  isSelected?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (playerId: number) => void;
  onClick?: () => void;
}

// Position-based colors for avatar ring
const positionColors: Record<string, string> = {
  G: "from-blue-500 to-cyan-400",
  F: "from-orange-500 to-yellow-400",
  C: "from-purple-500 to-pink-400",
  default: "from-primary to-emerald-400",
};

export function PlayerCard({ player, isSelected, isFavorite, onToggleFavorite, onClick }: PlayerCardProps) {
  const recentPts = player.recent_games.map((g) => g.PTS).reverse();
  const avgPts = player.season_averages.PTS;
  const lastPts = player.recent_games[0]?.PTS ?? 0;
  const ptsTrend = lastPts - avgPts;

  // Determine position color (simple heuristic based on stats)
  const isCenter = player.season_averages.REB > 7;
  const isGuard = player.season_averages.AST > 5;
  const posKey = isCenter ? "C" : isGuard ? "G" : "F";
  const ringColor = positionColors[posKey] || positionColors.default;

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(player.player_id);
  };

  return (
    <div
      onClick={onClick}
      data-testid={`player-card-${player.player_id}`}
      className={`
        p-3 rounded-lg cursor-pointer transition-all duration-300 group relative
        ${isSelected
          ? "bg-primary/10 border-2 border-primary/40 shadow-lg shadow-primary/10"
          : "bg-card/80 border border-border/50 hover:border-primary/30 hover:bg-card hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
        }
      `}
    >
      {/* Favorite Star */}
      <button
        onClick={handleFavoriteClick}
        className={`absolute top-2 right-2 p-1 rounded-full transition-all duration-200 z-10 ${isFavorite
            ? "text-yellow-400 hover:text-yellow-300"
            : "text-muted-foreground/40 hover:text-yellow-400 opacity-0 group-hover:opacity-100"
          }`}
        data-testid={`button-favorite-${player.player_id}`}
      >
        <Star className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
      </button>

      <div className="flex items-start gap-3">
        {/* Avatar with gradient ring */}
        <div className={`relative w-12 h-12 rounded-full bg-gradient-to-br ${ringColor} p-[2px] flex-shrink-0 group-hover:scale-105 transition-transform duration-300`}>
          <div className="w-full h-full rounded-full bg-card flex items-center justify-center text-lg font-bold text-foreground">
            {player.player_name.split(" ").map(n => n[0]).join("")}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{player.player_name}</h3>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-0">
              {player.team}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground uppercase">PTS</span>
              <span className="font-mono font-bold text-sm">{avgPts.toFixed(1)}</span>
              {ptsTrend !== 0 && (
                <span className={`flex items-center text-[10px] ${ptsTrend > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {ptsTrend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground uppercase">REB</span>
              <span className="font-mono font-bold text-sm">{player.season_averages.REB.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground uppercase">AST</span>
              <span className="font-mono font-bold text-sm">{player.season_averages.AST.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Sparkline with fade effect */}
        <div className="flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
          <Sparkline data={recentPts} width={60} height={24} />
        </div>
      </div>
    </div>
  );
}

