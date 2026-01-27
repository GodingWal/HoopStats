/**
 * GameCard component - displays a game matchup card
 */

import type { PotentialBet } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Flame } from "lucide-react";

interface GameCardProps {
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  bets: PotentialBet[];
  status?: string;
  onClick: () => void;
}

export function GameCard({ homeTeam, awayTeam, homeLogo, awayLogo, bets, status, onClick }: GameCardProps) {
  const highCount = bets.filter(b => b.confidence === "HIGH").length;

  return (
    <Card
      className="premium-card rounded-xl overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-1 flex-1">
            {awayLogo ? (
              <img src={awayLogo} alt={awayTeam} className="w-10 h-10 object-contain" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">{awayTeam}</div>
            )}
            <span className="text-sm font-bold">{awayTeam}</span>
          </div>

          <div className="px-3">
            <div className="text-xs text-muted-foreground font-bold">VS</div>
            {status && <div className="text-[10px] text-muted-foreground text-center mt-0.5">{status}</div>}
          </div>

          <div className="flex flex-col items-center gap-1 flex-1">
            {homeLogo ? (
              <img src={homeLogo} alt={homeTeam} className="w-10 h-10 object-contain" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">{homeTeam}</div>
            )}
            <span className="text-sm font-bold">{homeTeam}</span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{bets.length} bets</span>
          {highCount > 0 && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              <Flame className="w-3 h-3 mr-1" />
              {highCount} HIGH
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
