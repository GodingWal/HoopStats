import { useQuery } from "@tanstack/react-query";
import type { PotentialBet } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, RefreshCw, Target, Flame } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

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
    case "STOCKS": return "Steals+Blocks";
    default: return stat;
  }
}

function BetCard({ bet }: { bet: PotentialBet }) {
  const isOver = bet.recommendation === "OVER";
  
  return (
    <Card 
      className="hover-elevate transition-all"
      data-testid={`card-bet-${bet.player_id}-${bet.stat_type}-${bet.line}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span 
                className="font-semibold text-foreground truncate"
                data-testid={`text-player-${bet.player_id}`}
              >
                {bet.player_name}
              </span>
              <Badge variant="secondary" className="text-xs shrink-0">
                {bet.team}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{getStatLabel(bet.stat_type)}</span>
              <span className="font-mono">{bet.line}</span>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-1">
            <Badge 
              className={`${getConfidenceColor(bet.confidence)} flex items-center gap-1`}
              data-testid={`badge-confidence-${bet.id}`}
            >
              {bet.confidence === "HIGH" && <Flame className="w-3 h-3" />}
              {bet.confidence}
            </Badge>
            
            <div 
              className={`flex items-center gap-1 text-sm font-medium ${
                isOver ? "text-emerald-400" : "text-rose-400"
              }`}
              data-testid={`text-recommendation-${bet.id}`}
            >
              {isOver ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {bet.recommendation}
            </div>
          </div>
        </div>
        
        <div className="mt-3 pt-3 border-t border-border">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Hit Rate</div>
              <div 
                className="font-mono font-semibold text-foreground"
                data-testid={`text-hitrate-${bet.id}`}
              >
                {bet.hit_rate.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Season Avg</div>
              <div className="font-mono font-semibold text-foreground">
                {bet.season_avg.toFixed(1)}
              </div>
            </div>
            {bet.last_5_avg !== undefined && (
              <div>
                <div className="text-muted-foreground">L5 Avg</div>
                <div className="font-mono font-semibold text-foreground">
                  {bet.last_5_avg.toFixed(1)}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BetsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 9 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Bets() {
  const { data: bets, isLoading } = useQuery<PotentialBet[]>({
    queryKey: ["/api/bets"],
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

  const highConfidenceBets = bets?.filter((b) => b.confidence === "HIGH") || [];
  const mediumConfidenceBets = bets?.filter((b) => b.confidence === "MEDIUM") || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 
              className="text-2xl font-bold text-foreground flex items-center gap-2"
              data-testid="heading-bets"
            >
              <Target className="w-6 h-6 text-primary" />
              Potential Bets
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              High-confidence betting opportunities based on hit rate analysis
            </p>
          </div>
          
          <Button
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid="button-refresh-bets"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <BetsSkeleton />
        ) : (
          <>
            {highConfidenceBets.length > 0 && (
              <section className="mb-8">
                <Card className="mb-4 bg-emerald-500/5 border-emerald-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 text-emerald-400">
                      <Flame className="w-5 h-5" />
                      High Confidence ({highConfidenceBets.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      These picks have hit rates above 80% or below 25% this season
                    </p>
                  </CardContent>
                </Card>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {highConfidenceBets.map((bet) => (
                    <BetCard key={`${bet.player_id}-${bet.stat_type}-${bet.line}`} bet={bet} />
                  ))}
                </div>
              </section>
            )}

            {mediumConfidenceBets.length > 0 && (
              <section>
                <Card className="mb-4 bg-amber-500/5 border-amber-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2 text-amber-400">
                      <Target className="w-5 h-5" />
                      Medium Confidence ({mediumConfidenceBets.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      These picks have hit rates between 65-80% or 25-35% this season
                    </p>
                  </CardContent>
                </Card>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {mediumConfidenceBets.map((bet) => (
                    <BetCard key={`${bet.player_id}-${bet.stat_type}-${bet.line}`} bet={bet} />
                  ))}
                </div>
              </section>
            )}

            {bets?.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    No Bets Found
                  </h3>
                  <p className="text-muted-foreground">
                    Try refreshing to generate new betting opportunities
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
