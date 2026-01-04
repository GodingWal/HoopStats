import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PotentialBet } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, RefreshCw, Target, Flame, ArrowLeft, Swords } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

interface LiveGame {
  id: string;
  competitors: {
    homeAway: string;
    team: {
      abbreviation: string;
      displayName: string;
      logo: string;
    };
  }[];
  status: {
    type: { shortDetail: string; state: string; completed: boolean };
  };
}

function getConfidenceColor(confidence: string) {
  switch (confidence) {
    case "HIGH":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "MEDIUM":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default:
      return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
}

function getStatLabel(stat: string) {
  switch (stat) {
    case "PTS": return "Points";
    case "REB": return "Rebounds";
    case "AST": return "Assists";
    case "PRA": return "PTS+REB+AST";
    case "FG3M": return "3-Pointers";
    default: return stat;
  }
}

function BetRow({ bet }: { bet: PotentialBet }) {
  const isOver = bet.recommendation === "OVER";

  return (
    <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-all flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{bet.player_name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          {getStatLabel(bet.stat_type)} <span className="font-mono font-bold text-foreground">{bet.line}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className={`font-mono text-sm font-bold ${bet.hit_rate >= 70 ? 'text-emerald-400' : bet.hit_rate >= 50 ? 'text-foreground' : 'text-rose-400'
          }`}>{bet.hit_rate.toFixed(0)}%</div>

        {bet.confidence === "HIGH" && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs px-1.5">
            <Flame className="w-3 h-3" />
          </Badge>
        )}

        <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${isOver ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
          }`}>
          {isOver ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {bet.recommendation}
        </div>
      </div>
    </div>
  );
}

interface GameCardProps {
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  bets: PotentialBet[];
  status?: string;
  onClick: () => void;
}

function GameCard({ homeTeam, awayTeam, homeLogo, awayLogo, bets, status, onClick }: GameCardProps) {
  const highCount = bets.filter(b => b.confidence === "HIGH").length;

  return (
    <Card
      className="premium-card rounded-xl overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          {/* Away Team */}
          <div className="flex flex-col items-center gap-1 flex-1">
            {awayLogo ? (
              <img src={awayLogo} alt={awayTeam} className="w-10 h-10 object-contain" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">{awayTeam}</div>
            )}
            <span className="text-sm font-bold">{awayTeam}</span>
          </div>

          {/* VS */}
          <div className="px-3">
            <div className="text-xs text-muted-foreground font-bold">VS</div>
            {status && <div className="text-[10px] text-muted-foreground text-center mt-0.5">{status}</div>}
          </div>

          {/* Home Team */}
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

function BetsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="rounded-xl border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg shimmer" />
              <div className="w-8 h-4 rounded shimmer" />
              <div className="w-10 h-10 rounded-lg shimmer" />
            </div>
            <div className="mt-3 pt-3 border-t border-border/50 flex justify-between">
              <div className="w-16 h-4 rounded shimmer" />
              <div className="w-14 h-5 rounded shimmer" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Bets() {
  const [selectedGame, setSelectedGame] = useState<{ home: string; away: string } | null>(null);

  const { data: bets, isLoading: betsLoading } = useQuery<PotentialBet[]>({
    queryKey: ["/api/bets"],
  });

  const { data: games } = useQuery<LiveGame[]>({
    queryKey: ["/api/live-games"],
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bets/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
    },
  });

  // Create game matchups from bets (group by unique team pairs)
  const gameMatchups = useMemo(() => {
    if (!bets) return [];

    const teamSet = new Set(bets.map(b => b.team));
    const teams = Array.from(teamSet);

    // If we have live games data, use actual matchups
    if (games && games.length > 0) {
      return games.map(game => {
        const home = game.competitors.find(c => c.homeAway === "home");
        const away = game.competitors.find(c => c.homeAway === "away");
        if (!home || !away) return null;

        const gameBets = bets.filter(b =>
          b.team === home.team.abbreviation || b.team === away.team.abbreviation
        );

        return {
          homeTeam: home.team.abbreviation,
          awayTeam: away.team.abbreviation,
          homeLogo: home.team.logo,
          awayLogo: away.team.logo,
          status: game.status.type.shortDetail,
          bets: gameBets,
        };
      }).filter(Boolean).filter(g => g!.bets.length > 0);
    }

    // Fallback: show each team as a "matchup" with TBD opponent
    return teams.map(team => ({
      homeTeam: team,
      awayTeam: "TBD",
      bets: bets.filter(b => b.team === team),
    })).filter(g => g.bets.length > 0);
  }, [bets, games]);

  const selectedBets = useMemo(() => {
    if (!selectedGame || !bets) return [];
    return bets.filter(b =>
      b.team === selectedGame.home || b.team === selectedGame.away
    ).sort((a, b) => {
      if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
      if (a.confidence !== "HIGH" && b.confidence === "HIGH") return 1;
      return b.hit_rate - a.hit_rate;
    });
  }, [selectedGame, bets]);

  const totalBets = bets?.length || 0;
  const highConfidenceBets = bets?.filter(b => b.confidence === "HIGH").length || 0;

  // Detail view when a game is selected
  if (selectedGame) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-3xl fade-in">
          <Button
            variant="ghost"
            onClick={() => setSelectedGame(null)}
            className="mb-6 hover:bg-primary/10"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Games
          </Button>

          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-4 mb-2">
              <span className="text-2xl font-bold">{selectedGame.away}</span>
              <Swords className="w-6 h-6 text-muted-foreground" />
              <span className="text-2xl font-bold">{selectedGame.home}</span>
            </div>
            <div className="text-muted-foreground">{selectedBets.length} betting opportunities</div>
          </div>

          <div className="space-y-2">
            {selectedBets.map((bet) => (
              <BetRow key={`${bet.player_id}-${bet.stat_type}-${bet.line}`} bet={bet} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Main grid view
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-5xl fade-in">
        <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Target className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Potential Bets</h1>
              <p className="text-muted-foreground">Select a game to view bets</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {totalBets > 0 && (
              <div className="text-right text-sm">
                <div className="text-muted-foreground">{totalBets} bets</div>
                {highConfidenceBets > 0 && (
                  <div className="text-emerald-400 flex items-center gap-1 justify-end">
                    <Flame className="w-3 h-3" />
                    {highConfidenceBets} high
                  </div>
                )}
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="hover:border-primary/50"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {betsLoading ? (
          <BetsSkeleton />
        ) : gameMatchups.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger-fade">
            {gameMatchups.map((matchup: any) => (
              <GameCard
                key={`${matchup.awayTeam}-${matchup.homeTeam}`}
                homeTeam={matchup.homeTeam}
                awayTeam={matchup.awayTeam}
                homeLogo={matchup.homeLogo}
                awayLogo={matchup.awayLogo}
                status={matchup.status}
                bets={matchup.bets}
                onClick={() => setSelectedGame({ home: matchup.homeTeam, away: matchup.awayTeam })}
              />
            ))}
          </div>
        ) : (
          <Card className="rounded-xl border-border/50">
            <CardContent className="py-16 text-center">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 animate-pulse" />
                <Target className="w-10 h-10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/60" />
              </div>
              <h3 className="text-xl font-bold mb-2">No Games Found</h3>
              <p className="text-muted-foreground">Try refreshing to load betting opportunities</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
