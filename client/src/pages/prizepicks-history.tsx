import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  History,
  TrendingUp,
  TrendingDown,
  Calendar,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  LineChart,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface DailyLine {
  playerName: string;
  team: string;
  statType: string;
  openingLine: number;
  closingLine?: number;
  netMovement: number;
  numMovements: number;
  gameTime: string;
}

interface LineMovement {
  playerName: string;
  statType: string;
  oldLine: number;
  newLine: number;
  lineChange: number;
  direction: string;
  isSignificant: boolean;
  detectedAt: string;
}

interface PlayerTrend {
  gameDate: string;
  openingLine: number;
  closingLine?: number;
  actualValue?: number;
  hitOver?: boolean;
}

function getStatLabel(stat: string) {
  switch (stat) {
    case "PTS": return "Points";
    case "Points": return "Points";
    case "REB": return "Rebounds";
    case "Rebounds": return "Rebounds";
    case "AST": return "Assists";
    case "Assists": return "Assists";
    case "PRA": return "PTS+REB+AST";
    case "Pts+Rebs+Asts": return "PTS+REB+AST";
    case "FG3M": return "3-Pointers";
    case "3-Pointers Made": return "3-Pointers";
    case "FPTS": return "Fantasy Score";
    case "Fantasy Score": return "Fantasy Score";
    case "STL": return "Steals";
    case "Steals": return "Steals";
    case "BLK": return "Blocks";
    case "Blocked Shots": return "Blocks";
    case "TO": return "Turnovers";
    case "Turnovers": return "Turnovers";
    default: return stat;
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function DailyLinesView() {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [statFilter, setStatFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"player" | "movement" | "line">("movement");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data: datesData } = useQuery<{ dates: string[]; count: number }>({
    queryKey: ["/api/prizepicks/dates"],
  });

  const { data: historyData, isLoading, error } = useQuery<{
    date: string;
    lines: DailyLine[];
    count: number;
  }>({
    queryKey: ["/api/prizepicks/history", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/prizepicks/history?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!selectedDate,
  });

  const navigateDate = (direction: "prev" | "next") => {
    const currentDate = new Date(selectedDate);
    if (direction === "prev") {
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      currentDate.setDate(currentDate.getDate() + 1);
    }
    setSelectedDate(currentDate.toISOString().split("T")[0]);
  };

  const statTypes = useMemo(() => {
    if (!historyData?.lines) return [];
    const types = new Set(historyData.lines.map((l) => l.statType));
    return Array.from(types).sort();
  }, [historyData]);

  const filteredAndSortedLines = useMemo(() => {
    if (!historyData?.lines) return [];

    let filtered = historyData.lines;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.playerName.toLowerCase().includes(query) ||
          l.team.toLowerCase().includes(query)
      );
    }

    if (statFilter !== "all") {
      filtered = filtered.filter((l) => l.statType === statFilter);
    }

    return filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "player":
          comparison = a.playerName.localeCompare(b.playerName);
          break;
        case "movement":
          comparison = Math.abs(a.netMovement) - Math.abs(b.netMovement);
          break;
        case "line":
          comparison = a.openingLine - b.openingLine;
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [historyData, searchQuery, statFilter, sortBy, sortOrder]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-xl border-border/50">
        <CardContent className="py-16 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-4" />
          <h3 className="text-xl font-bold mb-2">Failed to Load Data</h3>
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error occurred"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date Navigation */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateDate("prev")}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-medium"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateDate("next")}
            disabled={selectedDate >= new Date().toISOString().split("T")[0]}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{filteredAndSortedLines.length} lines</span>
          {historyData?.lines && historyData.lines.length > 0 && (
            <span>
              |{" "}
              {historyData.lines.filter((l) => Math.abs(l.netMovement) >= 0.5).length}{" "}
              significant moves
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by player or team..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={statFilter} onValueChange={setStatFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by stat" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stats</SelectItem>
            {statTypes.map((stat) => (
              <SelectItem key={stat} value={stat}>
                {getStatLabel(stat)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSortBy(sortBy === "movement" ? "player" : "movement");
            setSortOrder("desc");
          }}
        >
          <ArrowUpDown className="w-4 h-4 mr-2" />
          {sortBy === "movement" ? "By Movement" : "By Player"}
        </Button>
      </div>

      {/* Lines Table */}
      {filteredAndSortedLines.length > 0 ? (
        <Card className="rounded-xl border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Stat</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Closing</TableHead>
                <TableHead className="text-right">Movement</TableHead>
                <TableHead className="text-center"># Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedLines.map((line, i) => (
                <TableRow key={`${line.playerName}-${line.statType}-${i}`}>
                  <TableCell className="font-medium">{line.playerName}</TableCell>
                  <TableCell>{line.team}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{getStatLabel(line.statType)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.openingLine.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.closingLine?.toFixed(1) ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {line.netMovement !== 0 && (
                      <span
                        className={`flex items-center justify-end gap-1 font-mono font-bold ${
                          line.netMovement > 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {line.netMovement > 0 ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        {line.netMovement > 0 ? "+" : ""}
                        {line.netMovement.toFixed(1)}
                      </span>
                    )}
                    {line.netMovement === 0 && (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {line.numMovements > 0 ? (
                      <Badge
                        variant={line.numMovements >= 3 ? "default" : "secondary"}
                      >
                        {line.numMovements}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="rounded-xl border-border/50">
          <CardContent className="py-16 text-center">
            <History className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-bold mb-2">No Data for This Date</h3>
            <p className="text-muted-foreground">
              No PrizePicks lines were tracked on {formatDate(selectedDate)}
            </p>
            {datesData?.dates && datesData.dates.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Try one of these dates:
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {datesData.dates.slice(0, 5).map((date) => (
                    <Button
                      key={date}
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedDate(date)}
                    >
                      {formatDate(date)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RecentMovementsView() {
  const { data, isLoading, error, refetch } = useQuery<{
    movements: LineMovement[];
    count: number;
  }>({
    queryKey: ["/api/prizepicks/movements"],
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading movements...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-xl border-border/50">
        <CardContent className="py-16 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-4" />
          <h3 className="text-xl font-bold mb-2">Failed to Load Movements</h3>
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.count || 0} recent line movements tracked
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {data?.movements && data.movements.length > 0 ? (
        <div className="space-y-2">
          {data.movements.map((movement, i) => (
            <Card
              key={`${movement.playerName}-${movement.statType}-${i}`}
              className={`rounded-lg overflow-hidden ${
                movement.isSignificant
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/50"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{movement.playerName}</span>
                      {movement.isSignificant && (
                        <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                          Significant
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {getStatLabel(movement.statType)}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-muted-foreground">
                          {movement.oldLine.toFixed(1)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-bold">{movement.newLine.toFixed(1)}</span>
                      </div>
                    </div>

                    <div
                      className={`flex items-center gap-1 px-2 py-1 rounded font-mono font-bold ${
                        movement.direction === "up"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-rose-500/10 text-rose-400"
                      }`}
                    >
                      {movement.direction === "up" ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                      {movement.lineChange > 0 ? "+" : ""}
                      {movement.lineChange.toFixed(1)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  Detected {formatTime(movement.detectedAt)} on{" "}
                  {formatDate(movement.detectedAt)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-xl border-border/50">
          <CardContent className="py-16 text-center">
            <TrendingUp className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-bold mb-2">No Recent Movements</h3>
            <p className="text-muted-foreground">
              Line movements will appear here as they are detected
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PlayerTrendView() {
  const [playerName, setPlayerName] = useState("");
  const [statType, setStatType] = useState("Points");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading, error } = useQuery<{
    playerName: string;
    statType: string;
    trend: PlayerTrend[];
    count: number;
  }>({
    queryKey: ["/api/prizepicks/player-trend", playerName, statType],
    queryFn: async () => {
      const res = await fetch(
        `/api/prizepicks/player-trend/${encodeURIComponent(playerName)}?stat=${encodeURIComponent(statType)}&days=30`
      );
      if (!res.ok) throw new Error("Failed to fetch trend");
      return res.json();
    },
    enabled: !!playerName && !!statType,
  });

  const handleSearch = () => {
    if (searchInput.trim()) {
      setPlayerName(searchInput.trim());
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <LineChart className="w-5 h-5" />
            Player Line Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Input
                type="text"
                placeholder="Enter player name..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Select value={statType} onValueChange={setStatType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select stat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Points">Points</SelectItem>
                <SelectItem value="Rebounds">Rebounds</SelectItem>
                <SelectItem value="Assists">Assists</SelectItem>
                <SelectItem value="Pts+Rebs+Asts">PRA</SelectItem>
                <SelectItem value="3-Pointers Made">3-Pointers</SelectItem>
                <SelectItem value="Fantasy Score">Fantasy</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSearch}>
              <Search className="w-4 h-4 mr-2" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading trend data...</span>
        </div>
      )}

      {error && (
        <Card className="rounded-xl border-border/50">
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-4" />
            <h3 className="text-xl font-bold mb-2">No Data Found</h3>
            <p className="text-muted-foreground">
              No trend data found for {playerName} - {getStatLabel(statType)}
            </p>
          </CardContent>
        </Card>
      )}

      {data?.trend && data.trend.length > 0 && (
        <Card className="rounded-xl border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">
              {data.playerName} - {getStatLabel(data.statType)} (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-center">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.trend.map((t, i) => (
                  <TableRow key={t.gameDate + i}>
                    <TableCell>{formatDate(t.gameDate)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t.openingLine.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.closingLine?.toFixed(1) ?? "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.actualValue?.toFixed(1) ?? "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      {t.hitOver !== undefined ? (
                        <Badge
                          className={
                            t.hitOver
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                          }
                        >
                          {t.hitOver ? "OVER" : "UNDER"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!playerName && (
        <Card className="rounded-xl border-border/50">
          <CardContent className="py-16 text-center">
            <Search className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-bold mb-2">Search for a Player</h3>
            <p className="text-muted-foreground">
              Enter a player name to see their line history over the past 30 days
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function PrizePicksHistory() {
  const [activeTab, setActiveTab] = useState("daily");

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl fade-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-primary/10">
            <History className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">PrizePicks Line Tracker</h1>
            <p className="text-muted-foreground">
              Historical line data for analysis
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="daily" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Daily Lines
            </TabsTrigger>
            <TabsTrigger value="movements" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Movements
            </TabsTrigger>
            <TabsTrigger value="trends" className="flex items-center gap-2">
              <LineChart className="w-4 h-4" />
              Trends
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <DailyLinesView />
          </TabsContent>

          <TabsContent value="movements">
            <RecentMovementsView />
          </TabsContent>

          <TabsContent value="trends">
            <PlayerTrendView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
