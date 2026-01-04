import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Player } from "@shared/schema";
import { PlayerCard } from "@/components/player-card";
import { PlayerDetail } from "@/components/player-detail";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, TrendingUp, BarChart3, X, Star, Filter } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";

function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

type FilterMode = "all" | "favorites";
type PositionFilter = "all" | "G" | "F" | "C";

export default function Home() {
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [minPts, setMinPts] = useState<string>("");

  const { favorites, toggleFavorite, isFavorite, count: favCount } = useFavorites();

  const { data: players, isLoading, error } = useQuery<Player[]>({
    queryKey: ["/api/players"],
  });

  const filteredPlayers = useMemo(() => {
    if (!players) return [];

    let result = [...players];

    // Text search
    if (searchQuery.trim()) {
      const query = normalizeString(searchQuery);
      result = result.filter(
        (p) =>
          normalizeString(p.player_name).includes(query) ||
          normalizeString(p.team).includes(query)
      );
    }

    // Favorites filter
    if (filterMode === "favorites") {
      result = result.filter((p) => favorites.includes(p.player_id));
    }

    // Position filter (heuristic based on stats)
    if (positionFilter !== "all") {
      result = result.filter((p) => {
        const reb = p.season_averages.REB;
        const ast = p.season_averages.AST;
        if (positionFilter === "C") return reb > 7;
        if (positionFilter === "G") return ast > 5 && reb <= 7;
        if (positionFilter === "F") return ast <= 5 && reb <= 7;
        return true;
      });
    }

    // Min points filter
    const minPtsNum = parseFloat(minPts);
    if (!isNaN(minPtsNum) && minPtsNum > 0) {
      result = result.filter((p) => p.season_averages.PTS >= minPtsNum);
    }

    return result;
  }, [players, searchQuery, filterMode, positionFilter, minPts, favorites]);

  const selectedPlayer = useMemo(() => {
    if (!players || !selectedPlayerId) return null;
    return players.find((p) => p.player_id === selectedPlayerId) ?? null;
  }, [players, selectedPlayerId]);

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-80 border-r border-border flex flex-col bg-sidebar">
        <div className="p-4 border-b border-sidebar-border space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-6 h-6 text-primary" />
            <h1 className="text-lg font-semibold">NBA Analytics</h1>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-sidebar-accent/50"
              data-testid="input-search"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery("")}
                data-testid="button-clear-search"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* Filters Row */}
          <div className="flex gap-2">
            <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
              <SelectTrigger className="flex-1 h-8 text-xs" data-testid="select-filter-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Players</SelectItem>
                <SelectItem value="favorites">
                  <div className="flex items-center gap-1">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    Favorites ({favCount})
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={positionFilter} onValueChange={(v) => setPositionFilter(v as PositionFilter)}>
              <SelectTrigger className="w-20 h-8 text-xs" data-testid="select-position">
                <SelectValue placeholder="Pos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="G">Guard</SelectItem>
                <SelectItem value="F">Forward</SelectItem>
                <SelectItem value="C">Center</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Min PTS filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Input
              type="number"
              placeholder="Min PTS"
              value={minPts}
              onChange={(e) => setMinPts(e.target.value)}
              className="h-8 text-xs flex-1"
              data-testid="input-min-pts"
            />
            {minPts && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMinPts("")}>
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {isLoading && (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="p-3 rounded-lg bg-card border border-border/50">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full shimmer" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-28 rounded shimmer" />
                        <div className="h-3 w-36 rounded shimmer" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Failed to load players</p>
                <p className="text-xs mt-1">Please try again later</p>
              </div>
            )}

            {!isLoading && !error && filteredPlayers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No players found</p>
                {(searchQuery || filterMode === "favorites" || positionFilter !== "all" || minPts) && (
                  <p className="text-xs mt-1">Try adjusting your filters</p>
                )}
              </div>
            )}

            <div className="stagger-fade space-y-2">
              {filteredPlayers.map((player) => (
                <PlayerCard
                  key={player.player_id}
                  player={player}
                  isSelected={selectedPlayerId === player.player_id}
                  isFavorite={isFavorite(player.player_id)}
                  onToggleFavorite={toggleFavorite}
                  onClick={() => setSelectedPlayerId(player.player_id)}
                />
              ))}
            </div>
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{filteredPlayers.length} of {players?.length ?? 0} players</span>
            {favCount > 0 && (
              <span className="ml-auto flex items-center gap-1">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                {favCount}
              </span>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {selectedPlayer ? (
          <div className="p-6 max-w-5xl mx-auto">
            <PlayerDetail player={selectedPlayer} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground max-w-lg px-6 fade-in">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 animate-pulse" />
                <BarChart3 className="w-12 h-12 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/60" />
              </div>
              <h2 className="text-2xl font-bold mb-3 text-foreground">NBA Betting Analytics</h2>
              <p className="text-sm leading-relaxed">
                Select a player from the sidebar to explore detailed statistics,
                hit rates, recent performance, and advanced matchup analysis.
              </p>
              <div className="mt-8 grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-card to-accent border border-border/50 hover:border-primary/30 transition-all duration-300 hover:-translate-y-1">
                  <div className="text-2xl font-bold stat-gradient">Hit Rates</div>
                  <div className="text-xs text-muted-foreground mt-2">Betting line analysis</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-card to-accent border border-border/50 hover:border-primary/30 transition-all duration-300 hover:-translate-y-1">
                  <div className="text-2xl font-bold stat-gradient">Matchups</div>
                  <div className="text-xs text-muted-foreground mt-2">Vs team performance</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-card to-accent border border-border/50 hover:border-primary/30 transition-all duration-300 hover:-translate-y-1">
                  <div className="text-2xl font-bold stat-gradient">Trends</div>
                  <div className="text-xs text-muted-foreground mt-2">Recent form tracking</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

