import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Player } from "@shared/schema";
import { PlayerCard } from "@/components/player-card";
import { PlayerDetail } from "@/components/player-detail";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, TrendingUp, BarChart3, X } from "lucide-react";

function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export default function Home() {
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: players, isLoading, error } = useQuery<Player[]>({
    queryKey: ["/api/players"],
  });

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    if (!searchQuery.trim()) return players;
    
    const query = normalizeString(searchQuery);
    return players.filter(
      (p) =>
        normalizeString(p.player_name).includes(query) ||
        normalizeString(p.team).includes(query)
    );
  }, [players, searchQuery]);

  const selectedPlayer = useMemo(() => {
    if (!players || !selectedPlayerId) return null;
    return players.find((p) => p.player_id === selectedPlayerId) ?? null;
  }, [players, selectedPlayerId]);

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-80 border-r border-border flex flex-col bg-sidebar">
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-6 h-6 text-primary" />
            <h1 className="text-lg font-semibold">NBA Analytics</h1>
          </div>
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
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {isLoading && (
              <>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="p-3 rounded-md bg-card">
                    <div className="flex items-start gap-3">
                      <Skeleton className="w-12 h-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  </div>
                ))}
              </>
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
                {searchQuery && (
                  <p className="text-xs mt-1">Try a different search term</p>
                )}
              </div>
            )}

            {filteredPlayers.map((player) => (
              <PlayerCard
                key={player.player_id}
                player={player}
                isSelected={selectedPlayerId === player.player_id}
                onClick={() => setSelectedPlayerId(player.player_id)}
              />
            ))}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{players?.length ?? 0} players tracked</span>
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
            <div className="text-center text-muted-foreground max-w-md px-4">
              <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <h2 className="text-xl font-semibold mb-2">NBA Betting Analytics</h2>
              <p className="text-sm">
                Select a player from the sidebar to view detailed statistics, 
                hit rates, recent performance, and matchup analysis.
              </p>
              <div className="mt-6 grid grid-cols-3 gap-4 text-xs">
                <div className="bg-muted/30 rounded-md p-3">
                  <div className="font-mono text-lg font-bold text-primary">Hit Rates</div>
                  <div className="text-muted-foreground mt-1">Betting line analysis</div>
                </div>
                <div className="bg-muted/30 rounded-md p-3">
                  <div className="font-mono text-lg font-bold text-primary">Matchups</div>
                  <div className="text-muted-foreground mt-1">Vs team performance</div>
                </div>
                <div className="bg-muted/30 rounded-md p-3">
                  <div className="font-mono text-lg font-bold text-primary">Trends</div>
                  <div className="text-muted-foreground mt-1">Recent form tracking</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
