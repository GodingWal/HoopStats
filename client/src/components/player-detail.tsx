import type { Player } from "@shared/schema";
import { StatBadge } from "./stat-badge";
import { Sparkline } from "./sparkline";
import { RecentGamesTable } from "./recent-games-table";
import { HitRateGrid } from "./hit-rate-grid";
import { VsTeamStats } from "./vs-team-stats";
import { HomeAwaySplits } from "./home-away-splits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, Target, Users, BarChart3 } from "lucide-react";

interface PlayerDetailProps {
  player: Player;
}

export function PlayerDetail({ player }: PlayerDetailProps) {
  const recentPts = player.recent_games.map((g) => g.PTS).reverse();
  const recentReb = player.recent_games.map((g) => g.REB).reverse();
  const recentAst = player.recent_games.map((g) => g.AST).reverse();

  const ptsTrend = (player.last_5_averages.PTS ?? player.season_averages.PTS) - player.season_averages.PTS;
  const rebTrend = (player.last_5_averages.REB ?? player.season_averages.REB) - player.season_averages.REB;
  const astTrend = (player.last_5_averages.AST ?? player.season_averages.AST) - player.season_averages.AST;

  return (
    <div className="space-y-6" data-testid="player-detail">
      <div className="flex items-start gap-6">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground flex-shrink-0">
          {player.player_name.split(" ").map(n => n[0]).join("")}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold" data-testid="player-name">{player.player_name}</h1>
            <Badge variant="secondary" className="text-sm">
              {player.team}
            </Badge>
            {player.games_played && (
              <span className="text-sm text-muted-foreground">
                {player.games_played} GP
              </span>
            )}
          </div>
          <div className="flex items-center gap-6 mt-4">
            <div className="flex items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">PTS</div>
                <div className="text-2xl font-mono font-bold">{player.season_averages.PTS.toFixed(1)}</div>
              </div>
              <Sparkline data={recentPts} width={50} height={24} />
            </div>
            <div className="flex items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">REB</div>
                <div className="text-2xl font-mono font-bold">{player.season_averages.REB.toFixed(1)}</div>
              </div>
              <Sparkline data={recentReb} width={50} height={24} />
            </div>
            <div className="flex items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">AST</div>
                <div className="text-2xl font-mono font-bold">{player.season_averages.AST.toFixed(1)}</div>
              </div>
              <Sparkline data={recentAst} width={50} height={24} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">PRA</div>
              <div className="text-2xl font-mono font-bold text-primary">{player.season_averages.PRA.toFixed(1)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Season Averages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <StatBadge label="PTS" value={player.season_averages.PTS} size="sm" />
              <StatBadge label="REB" value={player.season_averages.REB} size="sm" />
              <StatBadge label="AST" value={player.season_averages.AST} size="sm" />
              <StatBadge label="3PM" value={player.season_averages.FG3M} size="sm" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Last 10 Games
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <StatBadge 
                label="PTS" 
                value={player.last_10_averages.PTS ?? 0} 
                trend={ptsTrend}
                size="sm" 
              />
              <StatBadge 
                label="REB" 
                value={player.last_10_averages.REB ?? 0} 
                trend={rebTrend}
                size="sm" 
              />
              <StatBadge 
                label="AST" 
                value={player.last_10_averages.AST ?? 0} 
                trend={astTrend}
                size="sm" 
              />
              <StatBadge 
                label="3PM" 
                value={player.last_10_averages.FG3M ?? 0} 
                size="sm" 
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              Last 5 Games
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <StatBadge 
                label="PTS" 
                value={player.last_5_averages.PTS ?? 0} 
                size="sm" 
              />
              <StatBadge 
                label="REB" 
                value={player.last_5_averages.REB ?? 0} 
                size="sm" 
              />
              <StatBadge 
                label="AST" 
                value={player.last_5_averages.AST ?? 0} 
                size="sm" 
              />
              <StatBadge 
                label="PRA" 
                value={player.last_5_averages.PRA ?? 0} 
                size="sm" 
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              Home / Away Splits
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <HomeAwaySplits 
              homeAverages={player.home_averages}
              awayAverages={player.away_averages}
            />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="games" className="w-full">
        <TabsList className="w-full justify-start bg-muted/30">
          <TabsTrigger value="games" data-testid="tab-games">Recent Games</TabsTrigger>
          <TabsTrigger value="hitrates" data-testid="tab-hitrates">Hit Rates</TabsTrigger>
          <TabsTrigger value="matchups" data-testid="tab-matchups">Matchups</TabsTrigger>
        </TabsList>
        
        <TabsContent value="games" className="mt-4">
          <RecentGamesTable 
            games={player.recent_games}
            seasonAvg={player.season_averages}
          />
        </TabsContent>
        
        <TabsContent value="hitrates" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Points</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="PTS" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Rebounds</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="REB" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Assists</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="AST" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">PTS + REB + AST</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="PRA" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="matchups" className="mt-4">
          <VsTeamStats 
            vsTeam={player.vs_team}
            seasonAvg={player.season_averages}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
