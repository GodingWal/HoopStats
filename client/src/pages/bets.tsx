import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PotentialBet } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, RefreshCw, Target, Flame, ArrowLeft, Swords, Clock, Loader2 } from "lucide-react";
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

interface PrizePicksProjection {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  teamAbbr: string;
  position: string;
  statType: string;
  statTypeAbbr: string;
  line: number;
  gameTime: string;
  opponent: string;
  imageUrl?: string;
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

function formatGameTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
        <div className={`font-mono text-sm font-bold ${bet.hit_rate >= 70 ? 'text-emerald-400' : bet.hit_rate >= 50 ? 'text-foreground' : 'text-rose-400'}`}>
          {bet.hit_rate.toFixed(0)}%
        </div>

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
  );
}

function PrizePicksRow({ prop }: { prop: PrizePicksProjection }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-all flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {prop.imageUrl && (
          <img src={prop.imageUrl} alt={prop.playerName} className="w-10 h-10 rounded-full object-cover" />
        )}
        <div>
          <div className="font-medium text-sm">{prop.playerName}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{prop.teamAbbr}</span>
            <span>•</span>
            <span>{prop.position}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-xs text-muted-foreground">{prop.statType}</div>
          <div className="font-mono text-lg font-bold text-primary">{prop.line}</div>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatGameTime(prop.gameTime)}
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
interface PrizePicksGameCardProps {
  gameTime: string;
  props: PrizePicksProjection[];
  onClick: () => void;
}

function PrizePicksGameCard({ gameTime, props, onClick }: PrizePicksGameCardProps) {
  // Get unique teams from props
  const teams = useMemo(() => {
    const teamSet = new Set(props.map(p => p.teamAbbr));
    return Array.from(teamSet).slice(0, 2);
  }, [props]);

  const gameDate = new Date(gameTime);
  const timeStr = gameDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <Card
      className="premium-card rounded-xl overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-1 flex-1">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">
              {teams[0] || "TBD"}
            </div>
            <span className="text-sm font-bold">{teams[0] || "TBD"}</span>
          </div>

          <div className="px-3">
            <div className="text-xs text-muted-foreground font-bold">VS</div>
            <div className="text-[10px] text-muted-foreground text-center mt-0.5">{timeStr}</div>
          </div>

          <div className="flex flex-col items-center gap-1 flex-1">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">
              {teams[1] || "TBD"}
            </div>
            <span className="text-sm font-bold">{teams[1] || "TBD"}</span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{props.length} props</span>
          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
            PrizePicks
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function PrizePicksView() {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [statFilter, setStatFilter] = useState<string>("all");

  const { data: projections, isLoading, error } = useQuery<PrizePicksProjection[]>({
    queryKey: ["/api/prizepicks/projections"],
  });

  // Group projections by game time
  const gameGroups = useMemo(() => {
    if (!projections) return [];
    const groups = new Map<string, PrizePicksProjection[]>();

    for (const proj of projections) {
      const key = proj.gameTime;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(proj);
    }

    return Array.from(groups.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  }, [projections]);

  const selectedProps = useMemo(() => {
    if (!selectedGame || !projections) return [];
    let props = projections.filter(p => p.gameTime === selectedGame);
    if (statFilter !== "all") {
      props = props.filter(p => p.statTypeAbbr === statFilter);
    }
    return props;
  }, [selectedGame, projections, statFilter]);

  const statTypes = useMemo(() => {
    if (!selectedGame || !projections) return [];
    const gameProps = projections.filter(p => p.gameTime === selectedGame);
    const types = new Set(gameProps.map(p => p.statTypeAbbr));
    return Array.from(types).sort();
  }, [selectedGame, projections]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading PrizePicks lines...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-xl border-border/50">
        <CardContent className="py-16 text-center">
          <div className="text-rose-400 mb-2">Failed to load PrizePicks data</div>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "PrizePicks may be blocking requests"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!projections || projections.length === 0) {
    return (
      <Card className="rounded-xl border-border/50">
        <CardContent className="py-16 text-center">
          <Target className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-bold mb-2">No Props Available</h3>
          <p className="text-muted-foreground">No NBA player props found on PrizePicks right now</p>
        </CardContent>
      </Card>
    );
  }

  // Detail view when a game is selected
  if (selectedGame) {
    const gameDate = new Date(selectedGame);
    const gameProps = projections.filter(p => p.gameTime === selectedGame);
    const teams = Array.from(new Set(gameProps.map(p => p.teamAbbr))).slice(0, 2);

    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={() => { setSelectedGame(null); setStatFilter("all"); }}
          className="hover:bg-primary/10"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Games
        </Button>

        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-4 mb-2">
            <span className="text-2xl font-bold">{teams[0] || "TBD"}</span>
            <Swords className="w-6 h-6 text-muted-foreground" />
            <span className="text-2xl font-bold">{teams[1] || "TBD"}</span>
          </div>
          <div className="text-muted-foreground">
            {gameDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at {gameDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="text-sm text-muted-foreground mt-1">{selectedProps.length} props available</div>
        </div>

        {/* Stat Filter */}
        <div className="flex flex-wrap gap-2 justify-center">
          <Button
            variant={statFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatFilter("all")}
          >
            All
          </Button>
          {statTypes.map(stat => (
            <Button
              key={stat}
              variant={statFilter === stat ? "default" : "outline"}
              size="sm"
              onClick={() => setStatFilter(stat)}
            >
              {getStatLabel(stat)}
            </Button>
          ))}
        </div>

        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {selectedProps.map((prop) => (
            <PrizePicksRow key={prop.id} prop={prop} />
          ))}
        </div>

        <div className="text-xs text-muted-foreground text-center pt-2">
          Data from PrizePicks • Lines update every 10 minutes
        </div>
      </div>
    );
  }

  // Game cards grid view
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger-fade">
        {gameGroups.map(([gameTime, props]) => (
          <PrizePicksGameCard
            key={gameTime}
            gameTime={gameTime}
            props={props}
            onClick={() => setSelectedGame(gameTime)}
          />
        ))}
      </div>

      <div className="text-xs text-muted-foreground text-center pt-4">
        Data from PrizePicks • {projections.length} total props • Lines update every 10 minutes
      </div>
    </div>
  );
}


export default function Bets() {
  const [dataSource, setDataSource] = useState<"prizepicks" | "generated">("prizepicks");
  const [selectedGame, setSelectedGame] = useState<{ home: string; away: string } | null>(null);

  const { data: bets, isLoading: betsLoading } = useQuery<PotentialBet[]>({
    queryKey: ["/api/bets"],
    enabled: dataSource === "generated",
  });

  const { data: games } = useQuery<LiveGame[]>({
    queryKey: ["/api/live-games"],
    enabled: dataSource === "generated",
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

  const gameMatchups = useMemo(() => {
    if (!bets) return [];

    const teamSet = new Set(bets.map(b => b.team));
    const teams = Array.from(teamSet);

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

  if (selectedGame && dataSource === "generated") {
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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-5xl fade-in">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Target className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Player Props</h1>
              <p className="text-muted-foreground">Real lines from PrizePicks</p>
            </div>
          </div>

          {dataSource === "generated" && (
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
          )}
        </div>

        <Tabs value={dataSource} onValueChange={(v) => setDataSource(v as "prizepicks" | "generated")} className="mb-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="prizepicks" className="flex items-center gap-2">
              <img src="https://prizepicks.com/favicon.ico" alt="PP" className="w-4 h-4" onError={(e) => e.currentTarget.style.display = 'none'} />
              PrizePicks Lines
            </TabsTrigger>
            <TabsTrigger value="generated" className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              Our Analysis
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {dataSource === "prizepicks" ? (
          <PrizePicksView />
        ) : betsLoading ? (
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
