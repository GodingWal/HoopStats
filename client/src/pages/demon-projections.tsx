import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Flame,
  TrendingUp,
  TrendingDown,
  Search,
  Loader2,
  Bookmark,
  BookmarkCheck,
  Trash2,
  ArrowUpDown,
  Eye,
  Filter,
  BarChart3,
  Target,
  Clock,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---- Types ----

interface DemonProjection {
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
  oddsType?: string;
  playerAvg: {
    season: number | null;
    last5: number | null;
    last10: number | null;
  } | null;
  hitRate: number | null;
  overLikelihood: number | null;
}

interface TrackedPick {
  id: string;
  projectionId: string;
  playerName: string;
  team: string;
  statType: string;
  statTypeAbbr: string;
  line: number;
  overLikelihood: number | null;
  playerAvg: DemonProjection["playerAvg"];
  side: "over" | "under";
  trackedAt: string;
  result?: "hit" | "miss" | "push" | null;
  actualValue?: number | null;
  gameTime: string;
}

// ---- localStorage tracking hook ----

const TRACKED_KEY = "courtside-demon-tracked";

function useTrackedDemons() {
  const [tracked, setTracked] = useState<TrackedPick[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(TRACKED_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setTracked(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const persist = useCallback((items: TrackedPick[]) => {
    try {
      localStorage.setItem(TRACKED_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, []);

  const addPick = useCallback(
    (proj: DemonProjection, side: "over" | "under") => {
      setTracked((prev) => {
        // Avoid duplicates
        if (prev.some((p) => p.projectionId === proj.id && p.side === side))
          return prev;
        const pick: TrackedPick = {
          id: `${proj.id}-${side}-${Date.now()}`,
          projectionId: proj.id,
          playerName: proj.playerName,
          team: proj.team,
          statType: proj.statType,
          statTypeAbbr: proj.statTypeAbbr,
          line: proj.line,
          overLikelihood: proj.overLikelihood,
          playerAvg: proj.playerAvg,
          side,
          trackedAt: new Date().toISOString(),
          result: null,
          actualValue: null,
          gameTime: proj.gameTime,
        };
        const updated = [pick, ...prev];
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const removePick = useCallback(
    (pickId: string) => {
      setTracked((prev) => {
        const updated = prev.filter((p) => p.id !== pickId);
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const updateResult = useCallback(
    (pickId: string, result: "hit" | "miss" | "push", actualValue?: number) => {
      setTracked((prev) => {
        const updated = prev.map((p) =>
          p.id === pickId ? { ...p, result, actualValue: actualValue ?? null } : p
        );
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const clearAll = useCallback(() => {
    setTracked([]);
    persist([]);
  }, [persist]);

  const isTracked = useCallback(
    (projId: string) => tracked.some((p) => p.projectionId === projId),
    [tracked]
  );

  return { tracked, addPick, removePick, updateResult, clearAll, isTracked };
}

// ---- Helpers ----

function getStatLabel(stat: string) {
  const labels: Record<string, string> = {
    PTS: "Points",
    REB: "Rebounds",
    AST: "Assists",
    PRA: "PTS+REB+AST",
    FG3M: "3-Pointers",
    FPTS: "Fantasy Score",
    STL: "Steals",
    BLK: "Blocks",
    TO: "Turnovers",
    PR: "PTS+REB",
    PA: "PTS+AST",
    RA: "REB+AST",
  };
  return labels[stat] || stat;
}

function formatGameTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getOverColor(likelihood: number | null): string {
  if (likelihood === null) return "text-muted-foreground";
  if (likelihood >= 10) return "text-emerald-400";
  if (likelihood >= 3) return "text-emerald-400/80";
  if (likelihood >= 0) return "text-yellow-400";
  if (likelihood >= -5) return "text-orange-400";
  return "text-rose-400";
}

function getOverBg(likelihood: number | null): string {
  if (likelihood === null) return "bg-muted/30 border-border/50";
  if (likelihood >= 10) return "bg-emerald-500/10 border-emerald-500/30";
  if (likelihood >= 3) return "bg-emerald-500/5 border-emerald-500/20";
  if (likelihood >= 0) return "bg-yellow-500/5 border-yellow-500/20";
  return "bg-muted/30 border-border/50";
}

function getOverLabel(likelihood: number | null): string {
  if (likelihood === null) return "No Data";
  if (likelihood >= 15) return "Strong Over";
  if (likelihood >= 7) return "Likely Over";
  if (likelihood >= 3) return "Lean Over";
  if (likelihood >= 0) return "Slight Edge";
  if (likelihood >= -5) return "Toss-Up";
  return "Below Avg";
}

// ---- Page ----

export default function DemonProjectionsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statFilter, setStatFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"likelihood" | "line" | "player">("likelihood");
  const [activeTab, setActiveTab] = useState<"demons" | "tracked">("demons");

  const { tracked, addPick, removePick, updateResult, clearAll, isTracked } =
    useTrackedDemons();

  const {
    data: demons,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<DemonProjection[]>({
    queryKey: ["/api/prizepicks/demons"],
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
  });

  // Get unique stat types for filter
  const statTypes = Array.from(new Set((demons || []).map((d) => d.statTypeAbbr))).sort();

  // Filter & sort
  const filtered = (demons || [])
    .filter((d) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !d.playerName.toLowerCase().includes(q) &&
          !d.teamAbbr.toLowerCase().includes(q) &&
          !d.team.toLowerCase().includes(q)
        )
          return false;
      }
      if (statFilter !== "all" && d.statTypeAbbr !== statFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "likelihood")
        return (b.overLikelihood ?? -999) - (a.overLikelihood ?? -999);
      if (sortBy === "line") return b.line - a.line;
      return a.playerName.localeCompare(b.playerName);
    });

  // Track record stats
  const completedPicks = tracked.filter((p) => p.result);
  const hitCount = completedPicks.filter((p) => p.result === "hit").length;
  const totalResolved = completedPicks.length;
  const hitRate = totalResolved > 0 ? ((hitCount / totalResolved) * 100).toFixed(1) : "N/A";

  const handleTrack = (proj: DemonProjection, side: "over" | "under") => {
    addPick(proj, side);
    toast({
      title: "Demon Pick Tracked",
      description: `${proj.playerName} ${side.toUpperCase()} ${proj.line} ${proj.statType}`,
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-500/20">
          <Flame className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Demon Projections</h1>
          <p className="text-muted-foreground">
            PrizePicks demon lines analyzed against player averages — find the best overs
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-xl">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Flame className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{demons?.length ?? 0}</div>
              <div className="text-xs text-muted-foreground">Demon Lines</div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">
                {(demons || []).filter((d) => (d.overLikelihood ?? -999) >= 5).length}
              </div>
              <div className="text-xs text-muted-foreground">Likely Overs</div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Bookmark className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{tracked.length}</div>
              <div className="text-xs text-muted-foreground">Tracked Picks</div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Target className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{hitRate}%</div>
              <div className="text-xs text-muted-foreground">
                Hit Rate ({hitCount}/{totalResolved})
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "demons" | "tracked")}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="demons" className="gap-2">
              <Flame className="w-4 h-4" />
              Demon Lines
            </TabsTrigger>
            <TabsTrigger value="tracked" className="gap-2">
              <BookmarkCheck className="w-4 h-4" />
              Tracked ({tracked.length})
            </TabsTrigger>
          </TabsList>

          {activeTab === "demons" && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search player or team..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px] bg-muted/50"
                />
              </div>
              <Select value={statFilter} onValueChange={setStatFilter}>
                <SelectTrigger className="w-[140px] bg-muted/50">
                  <Filter className="w-3 h-3 mr-1" />
                  <SelectValue placeholder="All Stats" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stats</SelectItem>
                  {statTypes.map((st) => (
                    <SelectItem key={st} value={st}>
                      {getStatLabel(st)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-[150px] bg-muted/50">
                  <ArrowUpDown className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="likelihood">Over Likelihood</SelectItem>
                  <SelectItem value="line">Line Value</SelectItem>
                  <SelectItem value="player">Player Name</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>Refresh</span>
                )}
              </Button>
            </div>
          )}
        </div>
      </Tabs>

      {/* Demon Lines Tab */}
      {activeTab === "demons" && (
        <>
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
              <span className="ml-3 text-muted-foreground">Loading demon projections...</span>
            </div>
          )}

          {error && (
            <Card className="rounded-xl border-red-500/30 bg-red-500/5">
              <CardContent className="p-6 text-center">
                <Flame className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-red-400 font-medium">Failed to load demon projections</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {error instanceof Error ? error.message : "Unknown error"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => refetch()}
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && !error && filtered.length === 0 && (
            <div className="text-center py-16">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-red-500/20 to-orange-500/20 animate-pulse" />
                <Flame className="w-10 h-10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-500/60" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Demon Lines Available</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                {searchQuery || statFilter !== "all"
                  ? "No demon lines match your filters. Try adjusting your search."
                  : "PrizePicks hasn't posted demon lines yet. Check back closer to game time."}
              </p>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="grid gap-3">
              {filtered.map((demon) => (
                <DemonCard
                  key={demon.id}
                  demon={demon}
                  isTracked={isTracked(demon.id)}
                  onTrack={handleTrack}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Tracked Picks Tab */}
      {activeTab === "tracked" && (
        <TrackedPicksList
          tracked={tracked}
          onRemove={removePick}
          onUpdateResult={updateResult}
          onClear={clearAll}
        />
      )}
    </div>
  );
}

// ---- Demon Card ----

function DemonCard({
  demon,
  isTracked,
  onTrack,
}: {
  demon: DemonProjection;
  isTracked: boolean;
  onTrack: (proj: DemonProjection, side: "over" | "under") => void;
}) {
  const avg = demon.playerAvg;
  const likelihood = demon.overLikelihood;

  return (
    <Card className={`rounded-xl border transition-all hover:shadow-md ${getOverBg(likelihood)}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Player Info */}
          <div className="flex items-center gap-3 min-w-[200px] flex-1">
            <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {demon.imageUrl ? (
                <img
                  src={demon.imageUrl}
                  alt={demon.playerName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span className="text-xs font-bold text-muted-foreground">
                  {demon.playerName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </span>
              )}
            </div>
            <div>
              <div className="font-semibold">{demon.playerName}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span>{demon.teamAbbr}</span>
                <span>-</span>
                <span>{demon.position}</span>
                {demon.opponent && (
                  <>
                    <span>-</span>
                    <span>{demon.opponent}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Stat & Line */}
          <div className="text-center min-w-[100px]">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              {demon.statType}
            </div>
            <div className="text-xl font-bold font-mono flex items-center justify-center gap-1">
              <Flame className="w-4 h-4 text-red-500" />
              {demon.line}
            </div>
          </div>

          {/* Player Averages */}
          <div className="flex gap-3 text-center min-w-[200px]">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Season</div>
              <div className="font-mono text-sm font-bold">
                {avg?.season !== null && avg?.season !== undefined
                  ? avg.season.toFixed(1)
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Last 10</div>
              <div className="font-mono text-sm font-bold">
                {avg?.last10 !== null && avg?.last10 !== undefined
                  ? avg.last10.toFixed(1)
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Last 5</div>
              <div className="font-mono text-sm font-bold">
                {avg?.last5 !== null && avg?.last5 !== undefined
                  ? avg.last5.toFixed(1)
                  : "-"}
              </div>
            </div>
          </div>

          {/* Over Likelihood */}
          <div className="text-center min-w-[100px]">
            <div className="text-[10px] text-muted-foreground uppercase">Edge</div>
            <div className={`font-mono font-bold text-lg ${getOverColor(likelihood)}`}>
              {likelihood !== null ? `${likelihood > 0 ? "+" : ""}${likelihood.toFixed(1)}%` : "N/A"}
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] mt-0.5 ${getOverColor(likelihood)} border-current/30`}
            >
              {getOverLabel(likelihood)}
            </Badge>
          </div>

          {/* Game Time */}
          <div className="text-center min-w-[70px]">
            <div className="text-[10px] text-muted-foreground uppercase">Time</div>
            <div className="text-xs font-medium flex items-center gap-1 justify-center">
              <Clock className="w-3 h-3" />
              {formatGameTime(demon.gameTime)}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400"
              onClick={() => onTrack(demon, "over")}
              disabled={isTracked}
            >
              <TrendingUp className="w-3 h-3 mr-1" />
              Over
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 text-rose-400"
              onClick={() => onTrack(demon, "under")}
              disabled={isTracked}
            >
              <TrendingDown className="w-3 h-3 mr-1" />
              Under
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Tracked Picks List ----

function TrackedPicksList({
  tracked,
  onRemove,
  onUpdateResult,
  onClear,
}: {
  tracked: TrackedPick[];
  onRemove: (id: string) => void;
  onUpdateResult: (id: string, result: "hit" | "miss" | "push", actual?: number) => void;
  onClear: () => void;
}) {
  const [resultInput, setResultInput] = useState<Record<string, string>>({});

  const pending = tracked.filter((p) => !p.result);
  const completed = tracked.filter((p) => p.result);

  if (tracked.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 animate-pulse" />
          <Bookmark className="w-10 h-10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/60" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No Tracked Picks Yet</h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          Track demon picks from the Demon Lines tab to monitor your selections and record results.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Your Tracked Demon Picks
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-red-400"
          onClick={onClear}
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Clear All
        </Button>
      </div>

      {/* Pending Picks */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Pending ({pending.length})
          </h4>
          {pending.map((pick) => (
            <Card key={pick.id} className="rounded-xl border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-semibold">{pick.playerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {pick.team} - {pick.statType}
                    </div>
                  </div>
                  <div className="text-center">
                    <Badge
                      className={
                        pick.side === "over"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                      }
                    >
                      {pick.side === "over" ? (
                        <TrendingUp className="w-3 h-3 mr-1" />
                      ) : (
                        <TrendingDown className="w-3 h-3 mr-1" />
                      )}
                      {pick.side.toUpperCase()} {pick.line}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Actual"
                      className="w-20 h-8 text-xs bg-muted/50"
                      type="number"
                      step="0.5"
                      value={resultInput[pick.id] ?? ""}
                      onChange={(e) =>
                        setResultInput((prev) => ({
                          ...prev,
                          [pick.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      onClick={() => {
                        const actual = parseFloat(resultInput[pick.id] || "0");
                        onUpdateResult(pick.id, "hit", actual);
                      }}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs bg-rose-500/10 border-rose-500/30 text-rose-400"
                      onClick={() => {
                        const actual = parseFloat(resultInput[pick.id] || "0");
                        onUpdateResult(pick.id, "miss", actual);
                      }}
                    >
                      <XCircle className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => {
                        onUpdateResult(pick.id, "push", pick.line);
                      }}
                    >
                      <MinusCircle className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-muted-foreground hover:text-red-400"
                      onClick={() => onRemove(pick.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Completed Picks */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3" />
            Completed ({completed.length})
          </h4>
          {completed.map((pick) => (
            <Card
              key={pick.id}
              className={`rounded-xl ${
                pick.result === "hit"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : pick.result === "miss"
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-yellow-500/30 bg-yellow-500/5"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-semibold">{pick.playerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {pick.team} - {pick.statType}
                    </div>
                  </div>
                  <Badge
                    className={
                      pick.side === "over"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                    }
                  >
                    {pick.side.toUpperCase()} {pick.line}
                  </Badge>
                  {pick.actualValue !== null && pick.actualValue !== undefined && (
                    <div className="text-sm font-mono">
                      Actual: <span className="font-bold">{pick.actualValue}</span>
                    </div>
                  )}
                  <Badge
                    className={
                      pick.result === "hit"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : pick.result === "miss"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }
                  >
                    {pick.result === "hit" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                    {pick.result === "miss" && <XCircle className="w-3 h-3 mr-1" />}
                    {pick.result === "push" && <MinusCircle className="w-3 h-3 mr-1" />}
                    {pick.result?.toUpperCase()}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground hover:text-red-400"
                    onClick={() => onRemove(pick.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
