/**
 * BetRow component - displays a single bet recommendation
 */

import type { PotentialBet } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Flame, AlertCircle } from "lucide-react";
import { getStatLabel, getEdgeBadgeColor, getEdgeLabel } from "./utils";

interface BetRowProps {
  bet: PotentialBet;
}

export function BetRow({ bet }: BetRowProps) {
  const isOver = bet.recommendation === "OVER";
  const hasEdge = bet.edge_score && bet.edge_score > 0;
  const isInjuryEdge = bet.edge_type === "STAR_OUT" || bet.edge_type === "STAR_OUT_POTENTIAL";

  return (
    <div className={`p-3 rounded-lg transition-all ${hasEdge ? isInjuryEdge ? 'bg-gradient-to-r from-purple-500/15 to-transparent border border-purple-500/40' : 'bg-gradient-to-r from-primary/10 to-transparent border border-primary/30' : 'bg-muted/30'} hover:bg-muted/50`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm">{bet.player_name}</div>
            {isInjuryEdge && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30">
                <AlertCircle className="w-3 h-3 text-rose-400" />
                <span className="text-[10px] font-bold text-rose-400">INJURY</span>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {getStatLabel(bet.stat_type)} <span className="font-mono font-bold text-foreground">{bet.line}</span>
          </div>
          {hasEdge && bet.edge_description && (
            <div className={`text-xs italic mt-1 ${isInjuryEdge ? 'text-purple-300 font-medium' : 'text-muted-foreground'}`}>
              {bet.edge_description}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <div className={`font-mono text-sm font-bold ${bet.hit_rate >= 70 ? 'text-emerald-400' : bet.hit_rate >= 50 ? 'text-foreground' : 'text-rose-400'}`}>
              {bet.hit_rate.toFixed(0)}%
            </div>

            {hasEdge && bet.edge_type && (
              <Badge className={`${getEdgeBadgeColor(bet.edge_type)} text-xs px-1.5 capitalize`}>
                {getEdgeLabel(bet.edge_type)}
              </Badge>
            )}

            {bet.confidence === "HIGH" && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs px-1.5">
                <Flame className="w-3 h-3" />
              </Badge>
            )}

            <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${isOver ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"}`}>
              {isOver ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {bet.recommendation}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
