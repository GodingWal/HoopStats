import { useEffect } from "react";
import type { Player, VsTeamStats as VsTeamStatsType, AdvancedStats } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { StatBadge } from "./stat-badge";
import { Sparkline } from "./sparkline";
import { RecentGamesTable } from "./recent-games-table";
import { HitRateGrid } from "./hit-rate-grid";
import { VsTeamStats } from "./vs-team-stats";
import { HomeAwaySplits } from "./home-away-splits";
import { TrendChart } from "./trend-chart";
import { AlertManager, AlertBadge } from "./alert-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, Target, Users, BarChart3, Loader2, LineChart, Bell, Activity } from "lucide-react";

interface PlayerDetailProps {
  player: Player;
}

interface ESPNGamelogEntry {
  season: string;
  stats: { [key: string]: string };
  game: {
    id: string;
    date: string;
    opponent: {
      id: string;
      displayName: string;
      abbreviation: string;
      logo: string;
    };
    result: string;
    score: string;
    isHome: boolean;
  };
}

export function PlayerDetail({ player }: PlayerDetailProps) {
  // Fetch live gamelog from ESPN
  const { data: liveGamelog, isLoading: isLoadingGamelog } = useQuery<ESPNGamelogEntry[]>({
    queryKey: [`/api/players/${player.player_id}/gamelog`],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Fetch advanced stats
  // Fetch advanced stats
  const { data: allAdvancedStats, isLoading: isLoadingAdvanced, isError: isErrorAdvanced, error: advancedError } = useQuery<AdvancedStats[]>({
    queryKey: ['/api/stats/advanced'],
    staleTime: 1000 * 60 * 60, // 1 hour (league stats change slowly)
  });

  // Helper to normalize names for better matching
  const normalizeName = (name: string) => {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[.'-]/g, "") // Remove punctuation
      .replace(/\s+(jr|sr|ii|iii|iv)$/i, "") // Remove suffixes
      .replace(/\s+/g, " ") // Normalize spaces
      .trim();
  };

  const playerAdvancedStats = allAdvancedStats?.find(s => {
    const n1 = normalizeName(s.playerName);
    const n2 = normalizeName(player.player_name);
    return n1 === n2 || n1.includes(n2) || n2.includes(n1);
  });

  /* Debug logging */
  useEffect(() => {
    if (isErrorAdvanced) {
      console.error("Advanced Stats Error:", advancedError);
    }
    if (allAdvancedStats) {
      console.log("Looking for player:", player.player_name);
      console.log("Normalized target:", normalizeName(player.player_name));
      console.log("Found matched stats:", playerAdvancedStats);
      console.log("Total stats loaded:", allAdvancedStats.length);
      if (!playerAdvancedStats && allAdvancedStats.length > 0) {
        // Log potential close matches or the first few to check format
        console.log("Sample stats in list:", allAdvancedStats.slice(0, 3));
        console.log("Normalized sample:", allAdvancedStats.slice(0, 3).map(s => normalizeName(s.playerName)));
      }
    }
  }, [allAdvancedStats, playerAdvancedStats, player.player_name, isErrorAdvanced, advancedError]);

  // Transform ESPN gamelog to the format expected by RecentGamesTable
  const recentGames = liveGamelog?.slice(0, 10).map((entry) => ({
    WL: entry.game.result?.charAt(0) || "?",
    PTS: parseInt(entry.stats.PTS || "0", 10),
    REB: parseInt(entry.stats.REB || "0", 10),
    AST: parseInt(entry.stats.AST || "0", 10),
    FG3M: parseInt(entry.stats["3PM"] || entry.stats.FG3M || "0", 10),
    STL: parseInt(entry.stats.STL || "0", 10),
    BLK: parseInt(entry.stats.BLK || "0", 10),
    TOV: parseInt(entry.stats.TO || entry.stats.TOV || "0", 10),
    PF: parseInt(entry.stats.PF || "0", 10),
    MIN: parseInt(entry.stats.MIN?.split(":")[0] || "0", 10),
    OPPONENT: entry.game.opponent?.abbreviation || "?",
    GAME_DATE: entry.game.date ? new Date(entry.game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : "",
  })) || player.recent_games;

  // Helper to calculate averages from a subset of games
  const calcAvg = <T extends Record<string, number>>(games: T[], key: keyof T): number => {
    if (!games.length) return 0;
    const sum = games.reduce((acc, g) => acc + (g[key] as number), 0);
    return Math.round((sum / games.length) * 10) / 10;
  };


  // Calculate LIVE averages from ESPN data (or fallback to stored)
  const allGames = liveGamelog?.map((entry) => ({
    PTS: parseInt(entry.stats.PTS || "0", 10),
    REB: parseInt(entry.stats.REB || "0", 10),
    AST: parseInt(entry.stats.AST || "0", 10),
    FG3M: parseInt(entry.stats["3PM"] || entry.stats.FG3M || "0", 10),
    STL: parseInt(entry.stats.STL || "0", 10),
    BLK: parseInt(entry.stats.BLK || "0", 10),
    TOV: parseInt(entry.stats.TO || entry.stats.TOV || "0", 10),
    PF: parseInt(entry.stats.PF || "0", 10),
    MIN: parseInt(entry.stats.MIN?.split(":")[0] || "0", 10),
  })) || [];

  const normalizeAvgs = (avgs: any) => ({
    PTS: avgs?.PTS ?? avgs?.pts ?? 0,
    REB: avgs?.REB ?? avgs?.reb ?? 0,
    AST: avgs?.AST ?? avgs?.ast ?? 0,
    FG3M: avgs?.FG3M ?? avgs?.fg3m ?? 0,
    STL: avgs?.STL ?? avgs?.stl ?? 0,
    BLK: avgs?.BLK ?? avgs?.blk ?? 0,
    TOV: avgs?.TOV ?? avgs?.tov ?? 0,
    PF: avgs?.PF ?? avgs?.pf ?? 0,
    PRA: (avgs?.PTS ?? avgs?.pts ?? 0) + (avgs?.REB ?? avgs?.reb ?? 0) + (avgs?.AST ?? avgs?.ast ?? 0),
    MIN: avgs?.MIN ?? avgs?.min ?? 0,
  });

  const seasonAverages = allGames.length > 0 ? {
    PTS: calcAvg(allGames, 'PTS'),
    REB: calcAvg(allGames, 'REB'),
    AST: calcAvg(allGames, 'AST'),
    FG3M: calcAvg(allGames, 'FG3M'),
    STL: calcAvg(allGames, 'STL'),
    BLK: calcAvg(allGames, 'BLK'),
    TOV: calcAvg(allGames, 'TOV'),
    PF: calcAvg(allGames, 'PF'),
    PRA: calcAvg(allGames, 'PTS') + calcAvg(allGames, 'REB') + calcAvg(allGames, 'AST'),
    MIN: calcAvg(allGames, 'MIN'),
  } : normalizeAvgs(player.season_averages);

  const last10Games = allGames.slice(0, 10);
  const last10Averages = last10Games.length > 0 ? {
    PTS: calcAvg(last10Games, 'PTS'),
    REB: calcAvg(last10Games, 'REB'),
    AST: calcAvg(last10Games, 'AST'),
    FG3M: calcAvg(last10Games, 'FG3M'),
    STL: calcAvg(last10Games, 'STL'),
    BLK: calcAvg(last10Games, 'BLK'),
    TOV: calcAvg(last10Games, 'TOV'),
    PF: calcAvg(last10Games, 'PF'),
    PRA: calcAvg(last10Games, 'PTS') + calcAvg(last10Games, 'REB') + calcAvg(last10Games, 'AST'),
    MIN: calcAvg(last10Games, 'MIN'),
  } : player.last_10_averages;

  const last5Games = allGames.slice(0, 5);
  const last5Averages = last5Games.length > 0 ? {
    PTS: calcAvg(last5Games, 'PTS'),
    REB: calcAvg(last5Games, 'REB'),
    AST: calcAvg(last5Games, 'AST'),
    FG3M: calcAvg(last5Games, 'FG3M'),
    STL: calcAvg(last5Games, 'STL'),
    BLK: calcAvg(last5Games, 'BLK'),
    TOV: calcAvg(last5Games, 'TOV'),
    PF: calcAvg(last5Games, 'PF'),
    PRA: calcAvg(last5Games, 'PTS') + calcAvg(last5Games, 'REB') + calcAvg(last5Games, 'AST'),
    MIN: calcAvg(last5Games, 'MIN'),
  } : player.last_5_averages;

  const gamesPlayed = allGames.length || player.games_played || 0;

  const recentPts = recentGames.map((g) => g.PTS).reverse();
  const recentReb = recentGames.map((g) => g.REB).reverse();
  const recentAst = recentGames.map((g) => g.AST).reverse();

  const ptsTrend = (last5Averages.PTS ?? seasonAverages.PTS) - seasonAverages.PTS;
  const rebTrend = (last5Averages.REB ?? seasonAverages.REB) - seasonAverages.REB;
  const astTrend = (last5Averages.AST ?? seasonAverages.AST) - seasonAverages.AST;

  // Calculate vs_team matchup stats from live gamelog
  const vsTeamFromGamelog = liveGamelog ? (() => {
    const teamMap: Record<string, { pts: number[]; reb: number[]; ast: number[]; fg3m: number[]; stl: number[]; blk: number[]; tov: number[] }> = {};

    for (const entry of liveGamelog) {
      const opp = entry.game.opponent?.abbreviation;
      if (!opp) continue;
      if (!teamMap[opp]) {
        teamMap[opp] = { pts: [], reb: [], ast: [], fg3m: [], stl: [], blk: [], tov: [] };
      }
      teamMap[opp].pts.push(parseInt(entry.stats.PTS || "0"));
      teamMap[opp].reb.push(parseInt(entry.stats.REB || "0"));
      teamMap[opp].ast.push(parseInt(entry.stats.AST || "0"));
      teamMap[opp].fg3m.push(parseInt(entry.stats["3PM"] || entry.stats.FG3M || "0"));
      teamMap[opp].stl.push(parseInt(entry.stats.STL || "0"));
      teamMap[opp].blk.push(parseInt(entry.stats.BLK || "0"));
      teamMap[opp].tov.push(parseInt(entry.stats.TO || entry.stats.TOV || "0"));
    }

    const result: Record<string, { games: number; PTS: number; REB: number; AST: number; FG3M: number; STL: number; BLK: number; TOV: number; PRA: number }> = {};
    for (const [team, data] of Object.entries(teamMap)) {
      const avg = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;
      const pts = avg(data.pts);
      const reb = avg(data.reb);
      const ast = avg(data.ast);
      result[team] = {
        games: data.pts.length,
        PTS: pts,
        REB: reb,
        AST: ast,
        FG3M: avg(data.fg3m),
        STL: avg(data.stl),
        BLK: avg(data.blk),
        TOV: avg(data.tov),
        PRA: Math.round((pts + reb + ast) * 10) / 10,
      };
    }
    return result;
  })() : player.vs_team;

  return (
    <div className="space-y-6 fade-in" data-testid="player-detail">
      {/* Hero Section */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-card via-card to-accent/30 border border-border/50">
        <div className="flex items-start gap-6">
          {/* Large gradient avatar */}
          <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-emerald-400 p-[3px] flex-shrink-0 glow-effect">
            <div className="w-full h-full rounded-2xl bg-card flex items-center justify-center text-3xl font-bold text-foreground">
              {player.player_name.split(" ").map(n => n[0]).join("")}
            </div>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold" data-testid="player-name">{player.player_name}</h1>
              <Badge variant="secondary" className="text-sm px-3 py-1 bg-primary/10 text-primary border-0">
                {player.team}
              </Badge>
              {gamesPlayed > 0 && (
                <span className="text-sm text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {gamesPlayed} GP
                </span>
              )}
            </div>

            {/* Hero Stats Row */}
            <div className="flex items-center gap-8 mt-6">
              <div className="flex items-end gap-3 group">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">PTS</div>
                  <div className="text-4xl font-mono font-bold stat-gradient">{seasonAverages.PTS.toFixed(1)}</div>
                </div>
                <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                  <Sparkline data={recentPts} width={60} height={28} />
                </div>
              </div>
              <div className="flex items-end gap-3 group">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">REB</div>
                  <div className="text-4xl font-mono font-bold">{seasonAverages.REB.toFixed(1)}</div>
                </div>
                <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                  <Sparkline data={recentReb} width={60} height={28} />
                </div>
              </div>
              <div className="flex items-end gap-3 group">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">AST</div>
                  <div className="text-4xl font-mono font-bold">{seasonAverages.AST.toFixed(1)}</div>
                </div>
                <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                  <Sparkline data={recentAst} width={60} height={28} />
                </div>
              </div>
              <div className="ml-auto">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">PRA</div>
                <div className="text-4xl font-mono font-bold text-primary">{seasonAverages.PRA.toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger-fade">
        <Card className="premium-card rounded-xl overflow-hidden">
          <CardHeader className="pb-2 bg-gradient-to-br from-transparent to-primary/5">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Season Averages
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="grid grid-cols-2 gap-2">
              <StatBadge label="PTS" value={seasonAverages.PTS} size="sm" />
              <StatBadge label="REB" value={seasonAverages.REB} size="sm" />
              <StatBadge label="AST" value={seasonAverages.AST} size="sm" />
              <StatBadge label="3PM" value={seasonAverages.FG3M} size="sm" />
              <StatBadge label="STL" value={seasonAverages.STL} size="sm" />
              <StatBadge label="BLK" value={seasonAverages.BLK} size="sm" />
              <StatBadge label="TOV" value={seasonAverages.TOV} size="sm" />
              <StatBadge label="PF" value={seasonAverages.PF} size="sm" />
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
                value={last10Averages.PTS ?? 0}
                trend={ptsTrend}
                size="sm"
              />
              <StatBadge
                label="REB"
                value={last10Averages.REB ?? 0}
                trend={rebTrend}
                size="sm"
              />
              <StatBadge
                label="AST"
                value={last10Averages.AST ?? 0}
                trend={astTrend}
                size="sm"
              />
              <StatBadge
                label="3PM"
                value={last10Averages.FG3M ?? 0}
                size="sm"
              />
              <StatBadge
                label="STL"
                value={last10Averages.STL ?? 0}
                size="sm"
              />
              <StatBadge
                label="BLK"
                value={last10Averages.BLK ?? 0}
                size="sm"
              />
              <StatBadge
                label="TOV"
                value={last10Averages.TOV ?? 0}
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
                value={last5Averages.PTS ?? 0}
                size="sm"
              />
              <StatBadge
                label="REB"
                value={last5Averages.REB ?? 0}
                size="sm"
              />
              <StatBadge
                label="AST"
                value={last5Averages.AST ?? 0}
                size="sm"
              />
              <StatBadge
                label="STL"
                value={last5Averages.STL ?? 0}
                size="sm"
              />
              <StatBadge
                label="BLK"
                value={last5Averages.BLK ?? 0}
                size="sm"
              />
              <StatBadge
                label="TOV"
                value={last5Averages.TOV ?? 0}
                size="sm"
              />
              <StatBadge
                label="PRA"
                value={last5Averages.PRA ?? 0}
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
        <TabsList className="w-full justify-start bg-muted/30 flex-wrap">
          <TabsTrigger value="games" data-testid="tab-games">Recent Games</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">
            <LineChart className="w-4 h-4 mr-1" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="hitrates" data-testid="tab-hitrates">Hit Rates</TabsTrigger>
          <TabsTrigger value="matchups" data-testid="tab-matchups">Matchups</TabsTrigger>
          <TabsTrigger value="advanced" data-testid="tab-advanced">
            <Activity className="w-4 h-4 mr-1" />
            Advanced
          </TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">
            <Bell className="w-4 h-4 mr-1" />
            Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="games" className="mt-4">
          {isLoadingGamelog ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading live game data...</span>
            </div>
          ) : (
            <RecentGamesTable
              games={recentGames}
              seasonAvg={player.season_averages}
            />
          )}
        </TabsContent>

        <TabsContent value="trends" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Points Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="PTS"
                  seasonAvg={seasonAverages.PTS}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Rebounds Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="REB"
                  seasonAvg={seasonAverages.REB}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Assists Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="AST"
                  seasonAvg={seasonAverages.AST}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">PTS+REB+AST Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="PRA"
                  seasonAvg={seasonAverages.PRA}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Steals Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="STL"
                  seasonAvg={seasonAverages.STL}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Blocks Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="BLK"
                  seasonAvg={seasonAverages.BLK}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Turnovers Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  games={recentGames}
                  stat="TOV"
                  seasonAvg={seasonAverages.TOV}
                />
              </CardContent>
            </Card>
          </div>
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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Steals</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="STL" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Blocks</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="BLK" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Turnovers</CardTitle>
              </CardHeader>
              <CardContent>
                <HitRateGrid hitRates={player.hit_rates} stat="TOV" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="matchups" className="mt-4">
          <VsTeamStats
            vsTeam={vsTeamFromGamelog}
            seasonAvg={seasonAverages}
          />
        </TabsContent>

        <TabsContent value="advanced" className="mt-4">
          {isLoadingAdvanced ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading advanced stats...</span>
            </div>
          ) : isErrorAdvanced ? (
            <div className="text-center py-8 text-red-500 bg-red-500/10 rounded-lg p-4">
              <p className="font-medium">Failed to load advanced stats</p>
              <p className="text-sm mt-1 opacity-80">Please check the console for details.</p>
            </div>
          ) : !playerAdvancedStats ? (
            <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg">
              No advanced stats available for {player.player_name}
              {allAdvancedStats && allAdvancedStats.length > 0 && (
                <div className="text-xs text-muted-foreground mt-2">
                  (Loaded {allAdvancedStats.length} players but found no match)
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Usage Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{playerAdvancedStats.usageRate}%</div>
                  <p className="text-xs text-muted-foreground mt-1">Est. % of team plays used</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">True Shooting</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${playerAdvancedStats.tsPct > 60 ? 'text-emerald-500' : playerAdvancedStats.tsPct < 55 ? 'text-yellow-500' : ''}`}>
                    {playerAdvancedStats.tsPct}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Efficiency including FTs</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Net Rating</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${playerAdvancedStats.netRating > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {playerAdvancedStats.netRating > 0 ? '+' : ''}{playerAdvancedStats.netRating}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Est. point diff per 100 poss</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Assist Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{playerAdvancedStats.astPct}%</div>
                  <p className="text-xs text-muted-foreground mt-1">% of teammate FGs assisted</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Rebound Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{playerAdvancedStats.rebPct}%</div>
                  <p className="text-xs text-muted-foreground mt-1">% of available rebounds</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Impact (PIE)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{playerAdvancedStats.pie}</div>
                  <p className="text-xs text-muted-foreground mt-1">Player Impact Estimate</p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                Stat Alerts for {player.player_name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Set up alerts to track when this player hits specific stat thresholds.
              </p>
              <AlertManager
                playerId={player.player_id}
                playerName={player.player_name}
                seasonAvg={seasonAverages}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
