import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Search,
  AlertTriangle,
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  History,
  BarChart2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface LineMovement {
  id: number;
  prizePicksLineId: number;
  playerName?: string;
  team?: string;
  statType?: string;
  oldLine: number;
  newLine: number;
  lineChange: number;
  direction: "up" | "down";
  magnitude: number;
  isSignificant: boolean;
  detectedAt: string;
}

interface CurrentLine {
  id: number;
  prizePicksId: string;
  prizePicksPlayerId: string;
  playerName: string;
  team: string;
  statType: string;
  line: number;
  gameTime: string;
  capturedAt: string;
  isActive: boolean;
}

interface DailyLine {
  id: number;
  playerName: string;
  team: string;
  statType: string;
  gameDate: string;
  openingLine: number;
  closingLine: number | null;
  netMovement: number;
  numMovements: number;
  highLine: number;
  lowLine: number;
}

interface TrackerStats {
  isRunning: boolean;
  linesTracked: number;
  lastPollTime: string | null;
  pollCount: number;
  movementsDetected: number;
}

interface BdlPlayerStats {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  gamesPlayed: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  fg_pct: number;
  min: string;
  season: number;
}

interface BdlActiveResponse {
  players: BdlPlayerStats[];
  nextCursor?: number;
}

export default function LineHistory() {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [bdlSearch, setBdlSearch] = useState("");
  const [bdlCursor, setBdlCursor] = useState<number | undefined>(undefined);

  // Fetch tracker status
  const { data: trackerStats, refetch: refetchStats } = useQuery<TrackerStats>({
    queryKey: ["/api/prizepicks/tracker/status"],
    refetchInterval: 30000,
  });

  // Fetch recent movements
  const { data: movements, isLoading: movementsLoading } = useQuery<LineMovement[]>({
    queryKey: ["/api/prizepicks/movements", { limit: 100 }],
    refetchInterval: 60000,
  });

  // Fetch significant movements
  const { data: significantMovements } = useQuery<LineMovement[]>({
    queryKey: ["/api/prizepicks/movements/significant", { hours: 24 }],
    refetchInterval: 60000,
  });

  // Fetch current lines
  const { data: currentLines, isLoading: linesLoading } = useQuery<CurrentLine[]>({
    queryKey: ["/api/prizepicks/lines/all"],
    refetchInterval: 60000,
  });

  // Fetch daily summary
  const { data: dailyLines } = useQuery<DailyLine[]>({
    queryKey: ["/api/prizepicks/daily"],
    refetchInterval: 300000,
  });

  // BallDontLie active players
  const { data: bdlData, isLoading: bdlLoading } = useQuery<BdlActiveResponse>({
    queryKey: ["/api/players/bdl-active", bdlCursor],
    queryFn: () =>
      fetch(`/api/players/bdl-active${bdlCursor ? `?cursor=${bdlCursor}` : ""}`)
        .then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // BallDontLie search result
  const { data: bdlSearchResult, isLoading: bdlSearchLoading } = useQuery<BdlPlayerStats>({
    queryKey: ["/api/players/bdl-stats", bdlSearch],
    queryFn: () =>
      fetch(`/api/players/bdl-stats?name=${encodeURIComponent(bdlSearch)}`).then((r) => r.json()),
    enabled: bdlSearch.trim().length >= 3,
    staleTime: 5 * 60 * 1000,
  });

  // Group current lines by player
  const linesByPlayer = currentLines?.reduce((acc, line) => {
    if (!acc[line.playerName]) {
      acc[line.playerName] = {
        playerName: line.playerName,
        team: line.team,
        lines: [],
      };
    }
    acc[line.playerName].lines.push(line);
    return acc;
  }, {} as Record<string, { playerName: string; team: string; lines: CurrentLine[] }>);

  // Filter lines by search
  const filteredPlayers = linesByPlayer
    ? Object.values(linesByPlayer).filter(
        (p) =>
          p.playerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.team.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  // Sort by team then name
  filteredPlayers.sort((a, b) => {
    if (a.team !== b.team) return a.team.localeCompare(b.team);
    return a.playerName.localeCompare(b.playerName);
  });

  const formatLine = (line: number) => line.toFixed(1);

  const getMovementColor = (direction: "up" | "down", isSignificant: boolean) => {
    if (direction === "up") {
      return isSignificant ? "text-red-500" : "text-red-400/70";
    }
    return isSignificant ? "text-green-500" : "text-green-400/70";
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-primary/10">
          <History className="w-7 h-7 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Line History</h1>
          <p className="text-muted-foreground">
            Track PrizePicks line movements throughout the day
          </p>
        </div>
        <div className="flex items-center gap-2">
          {trackerStats?.isRunning ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
              <Activity className="w-3 h-3 mr-1 animate-pulse" />
              Tracking Active
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
              <Clock className="w-3 h-3 mr-1" />
              Tracker Idle
            </Badge>
          )}
          {trackerStats?.lastPollTime && (
            <span className="text-xs text-muted-foreground">
              Updated {formatDistanceToNow(new Date(trackerStats.lastPollTime), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="premium-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-primary">
              {trackerStats?.linesTracked || 0}
            </div>
            <div className="text-xs text-muted-foreground">Lines Tracked</div>
          </CardContent>
        </Card>
        <Card className="premium-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-amber-500">
              {significantMovements?.length || 0}
            </div>
            <div className="text-xs text-muted-foreground">Significant Moves (24h)</div>
          </CardContent>
        </Card>
        <Card className="premium-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {movements?.filter((m) => m.direction === "up").length || 0}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-red-500" /> Lines Up
            </div>
          </CardContent>
        </Card>
        <Card className="premium-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {movements?.filter((m) => m.direction === "down").length || 0}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-green-500" /> Lines Down
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="player-stats" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="player-stats">Player Stats</TabsTrigger>
          <TabsTrigger value="movements">Recent Movements</TabsTrigger>
          <TabsTrigger value="alerts">Significant Alerts</TabsTrigger>
          <TabsTrigger value="all-lines">All Lines</TabsTrigger>
        </TabsList>

        {/* Player Stats Tab (BallDontLie) */}
        <TabsContent value="player-stats" className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search player by name..."
                value={bdlSearch}
                onChange={(e) => setBdlSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Single player search result */}
          {bdlSearch.trim().length >= 3 && (
            <div>
              {bdlSearchLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : bdlSearchResult && !("error" in bdlSearchResult) ? (
                <Card className="premium-card border-primary/20">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-bold text-lg">{bdlSearchResult.playerName}</div>
                        <div className="text-sm text-muted-foreground">{bdlSearchResult.team} · {bdlSearchResult.position} · {bdlSearchResult.gamesPlayed} GP · {bdlSearchResult.season}-{String(bdlSearchResult.season + 1).slice(-2)} Season</div>
                      </div>
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">BallDontLie</Badge>
                    </div>
                    <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
                      {[
                        { label: "PTS", val: bdlSearchResult.pts.toFixed(1) },
                        { label: "REB", val: bdlSearchResult.reb.toFixed(1) },
                        { label: "AST", val: bdlSearchResult.ast.toFixed(1) },
                        { label: "STL", val: bdlSearchResult.stl.toFixed(1) },
                        { label: "BLK", val: bdlSearchResult.blk.toFixed(1) },
                        { label: "3PM", val: bdlSearchResult.fg3m.toFixed(1) },
                        { label: "FG%", val: (bdlSearchResult.fg_pct * 100).toFixed(1) + "%" },
                      ].map(({ label, val }) => (
                        <div key={label} className="text-center p-2 rounded-lg bg-muted/40">
                          <div className="text-lg font-bold text-primary">{val}</div>
                          <div className="text-xs text-muted-foreground">{label}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-sm text-muted-foreground p-3">No player found for "{bdlSearch}"</div>
              )}
            </div>
          )}

          {/* Active players list */}
          {!bdlSearch.trim() && (
            <>
              {bdlLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : !bdlData || bdlData.players.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <BarChart2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">No Stats Available</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                      Make sure BALLDONTLIE_API_KEY is set in your environment
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="space-y-2">
                    {bdlData.players.map((player) => (
                      <Card key={player.playerId} className="premium-card">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <div className="font-medium">{player.playerName}</div>
                              <div className="text-xs text-muted-foreground">{player.team} · {player.position} · {player.gamesPlayed} GP</div>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="outline" className="text-xs">{player.pts.toFixed(1)} PTS</Badge>
                              <Badge variant="outline" className="text-xs">{player.reb.toFixed(1)} REB</Badge>
                              <Badge variant="outline" className="text-xs">{player.ast.toFixed(1)} AST</Badge>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 mt-2">
                            {[
                              { label: "STL", val: player.stl.toFixed(1) },
                              { label: "BLK", val: player.blk.toFixed(1) },
                              { label: "3PM", val: player.fg3m.toFixed(1) },
                              { label: "FG%", val: (player.fg_pct * 100).toFixed(1) + "%" },
                            ].map(({ label, val }) => (
                              <div key={label} className="text-center p-1.5 rounded bg-muted/30">
                                <div className="font-bold text-sm">{val}</div>
                                <div className="text-xs text-muted-foreground">{label}</div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <div className="flex justify-center gap-2 pt-2">
                    {bdlCursor && (
                      <Button variant="outline" size="sm" onClick={() => setBdlCursor(undefined)}>
                        First Page
                      </Button>
                    )}
                    {bdlData.nextCursor && (
                      <Button variant="outline" size="sm" onClick={() => setBdlCursor(bdlData.nextCursor)}>
                        Next Page
                      </Button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* Recent Movements Tab */}
        <TabsContent value="movements" className="space-y-4">
          {movementsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !movements || movements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <RefreshCw className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No Line Movements Yet</h3>
                <p className="text-muted-foreground mt-2">
                  Line movements will appear here as they are detected throughout the day
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {movements.slice(0, 50).map((movement) => (
                <Card key={movement.id} className="premium-card">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            movement.direction === "up"
                              ? "bg-red-500/10"
                              : "bg-green-500/10"
                          }`}
                        >
                          {movement.direction === "up" ? (
                            <TrendingUp className="w-4 h-4 text-red-500" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-green-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {movement.playerName || "Unknown Player"}
                            {movement.isSignificant && (
                              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Significant
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {movement.team} - {movement.statType}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {formatLine(movement.oldLine)}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span
                            className={`font-bold ${getMovementColor(
                              movement.direction,
                              movement.isSignificant
                            )}`}
                          >
                            {formatLine(movement.newLine)}
                          </span>
                          <Badge
                            variant="outline"
                            className={`ml-2 ${
                              movement.direction === "up"
                                ? "text-red-500 border-red-500/30"
                                : "text-green-500 border-green-500/30"
                            }`}
                          >
                            {movement.direction === "up" ? "+" : ""}
                            {movement.lineChange.toFixed(1)}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(movement.detectedAt), {
                            addSuffix: true,
                          })}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Significant Alerts Tab */}
        <TabsContent value="alerts" className="space-y-4">
          {!significantMovements || significantMovements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No Significant Movements</h3>
                <p className="text-muted-foreground mt-2">
                  Large line movements (0.5+ points) will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {significantMovements.map((movement) => (
                <Card
                  key={movement.id}
                  className="premium-card border-amber-500/30"
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-500/10">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        </div>
                        <div>
                          <div className="font-medium">
                            {movement.playerName || "Unknown Player"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {movement.team} - {movement.statType}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {formatLine(movement.oldLine)}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span
                            className={`font-bold text-lg ${getMovementColor(
                              movement.direction,
                              true
                            )}`}
                          >
                            {formatLine(movement.newLine)}
                          </span>
                          <Badge
                            className={`ml-2 ${
                              movement.direction === "up"
                                ? "bg-red-500 text-white"
                                : "bg-green-500 text-white"
                            }`}
                          >
                            {movement.direction === "up" ? "+" : ""}
                            {movement.lineChange.toFixed(1)}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {format(new Date(movement.detectedAt), "MMM d, h:mm a")}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* All Lines Tab */}
        <TabsContent value="all-lines" className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by player or team..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {linesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredPlayers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No Lines Found</h3>
                <p className="text-muted-foreground mt-2">
                  {searchQuery
                    ? "Try a different search term"
                    : "PrizePicks lines will appear here once captured"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredPlayers.map((player) => (
                <Card key={player.playerName} className="premium-card">
                  <CardHeader
                    className="p-4 cursor-pointer"
                    onClick={() =>
                      setExpandedPlayer(
                        expandedPlayer === player.playerName
                          ? null
                          : player.playerName
                      )
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">
                          {player.playerName}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {player.team} - {player.lines.length} props
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {player.lines.slice(0, 3).map((line) => (
                            <Badge
                              key={`${line.statType}-${line.id}`}
                              variant="outline"
                              className="text-xs"
                            >
                              {line.statType}: {formatLine(line.line)}
                            </Badge>
                          ))}
                          {player.lines.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{player.lines.length - 3}
                            </Badge>
                          )}
                        </div>
                        {expandedPlayer === player.playerName ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  {expandedPlayer === player.playerName && (
                    <CardContent className="pt-0 pb-4">
                      <div className="grid gap-2 mt-2">
                        {player.lines.map((line) => (
                          <div
                            key={line.id}
                            className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                          >
                            <div>
                              <span className="font-medium">{line.statType}</span>
                              <span className="text-muted-foreground text-sm ml-2">
                                vs{" "}
                                {format(new Date(line.gameTime), "MMM d 'at' h:mm a")}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xl font-bold text-primary">
                                {formatLine(line.line)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Updated{" "}
                                {formatDistanceToNow(new Date(line.capturedAt), {
                                  addSuffix: true,
                                })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Daily Summary */}
      {dailyLines && dailyLines.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Today's Line Summary
          </h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {dailyLines
              .filter((d) => d.numMovements > 0)
              .slice(0, 12)
              .map((daily) => (
                <Card key={daily.id} className="premium-card">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-medium">{daily.playerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {daily.team} - {daily.statType}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          daily.netMovement > 0
                            ? "text-red-500 border-red-500/30"
                            : daily.netMovement < 0
                            ? "text-green-500 border-green-500/30"
                            : ""
                        }
                      >
                        {daily.netMovement > 0 ? "+" : ""}
                        {daily.netMovement.toFixed(1)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Open: {formatLine(daily.openingLine)}
                      </span>
                      <span className="text-muted-foreground">
                        {daily.numMovements} move{daily.numMovements !== 1 ? "s" : ""}
                      </span>
                      <span className="font-medium">
                        Current: {formatLine(daily.closingLine || daily.openingLine)}
                      </span>
                    </div>
                    {daily.highLine !== daily.lowLine && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Range: {formatLine(daily.lowLine)} - {formatLine(daily.highLine)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
