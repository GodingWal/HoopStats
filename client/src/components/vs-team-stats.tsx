import { useState, useMemo } from "react";
import type { VsTeamStats as VsTeamStatsType } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, ArrowUpDown, Search } from "lucide-react";

type SortKey = "PRA" | "PTS" | "REB" | "AST" | "FG3M" | "games";

interface VsTeamMatchup extends VsTeamStatsType {
  games: number;
  PRA: number;
  wins?: number;
  losses?: number;
  lastGameDate?: string;
}

interface VsTeamStatsProps {
  vsTeam: Record<string, VsTeamMatchup>;
  seasonAvg: {
    PTS: number;
    REB: number;
    AST: number;
    PRA: number;
  };
}

function getDiffIndicator(value: number, avg: number): { text: string; color: string } {
  const diff = value - avg;
  const pctDiff = avg !== 0 ? (diff / avg) * 100 : 0;

  if (pctDiff > 10) return { text: `+${diff.toFixed(1)}`, color: "text-emerald-400" };
  if (pctDiff < -10) return { text: diff.toFixed(1), color: "text-red-400" };
  return { text: "~", color: "text-muted-foreground" };
}

function getPerformanceBg(pra: number, avgPra: number): string {
  const pctDiff = avgPra !== 0 ? ((pra - avgPra) / avgPra) * 100 : 0;
  if (pctDiff > 15) return "bg-emerald-500/8 border-emerald-500/20";
  if (pctDiff > 5) return "bg-emerald-500/4 border-emerald-500/10";
  if (pctDiff < -15) return "bg-red-500/8 border-red-500/20";
  if (pctDiff < -5) return "bg-red-500/4 border-red-500/10";
  return "bg-muted/20 border-border";
}

export function VsTeamStats({ vsTeam, seasonAvg }: VsTeamStatsProps) {
  const [sortBy, setSortBy] = useState<SortKey>("PRA");
  const [sortDesc, setSortDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  const teams = useMemo(() => {
    let entries = Object.entries(vsTeam);

    // Apply search filter
    if (searchFilter) {
      const q = searchFilter.toUpperCase();
      entries = entries.filter(([team]) => team.includes(q));
    }

    // Sort
    entries.sort((a, b) => {
      const valA = sortBy === "games" ? a[1].games : (a[1][sortBy] ?? 0);
      const valB = sortBy === "games" ? b[1].games : (b[1][sortBy] ?? 0);
      return sortDesc ? valB - valA : valA - valB;
    });

    return entries;
  }, [vsTeam, sortBy, sortDesc, searchFilter]);

  const INITIAL_DISPLAY = 5;
  const displayedTeams = showAll ? teams : teams.slice(0, INITIAL_DISPLAY);
  const totalTeams = Object.keys(vsTeam).length;
  const hasMore = teams.length > INITIAL_DISPLAY;

  if (totalTeams === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        No matchup data available
      </div>
    );
  }

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(key);
      setSortDesc(true);
    }
  };

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "PRA", label: "PRA" },
    { key: "PTS", label: "PTS" },
    { key: "REB", label: "REB" },
    { key: "AST", label: "AST" },
    { key: "FG3M", label: "3PM" },
    { key: "games", label: "Games" },
  ];

  // Summary stats
  const allTeamEntries = Object.values(vsTeam);
  const totalGames = allTeamEntries.reduce((sum, s) => sum + s.games, 0);
  const bestMatchup = Object.entries(vsTeam).reduce((best, [team, stats]) =>
    stats.PRA > (best?.stats.PRA ?? 0) ? { team, stats } : best,
    null as { team: string; stats: VsTeamMatchup } | null
  );
  const worstMatchup = Object.entries(vsTeam).reduce((worst, [team, stats]) =>
    stats.PRA < (worst?.stats.PRA ?? Infinity) ? { team, stats } : worst,
    null as { team: string; stats: VsTeamMatchup } | null
  );

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <Badge variant="secondary" className="text-xs px-2 py-0.5">
          {totalTeams} {totalTeams === 1 ? "team" : "teams"} faced
        </Badge>
        <Badge variant="secondary" className="text-xs px-2 py-0.5">
          {totalGames} {totalGames === 1 ? "game" : "games"} total
        </Badge>
        {bestMatchup && (
          <span className="text-emerald-400 text-xs">
            Best: vs {bestMatchup.team} ({bestMatchup.stats.PRA.toFixed(1)} PRA)
          </span>
        )}
        {worstMatchup && (
          <span className="text-red-400 text-xs">
            Worst: vs {worstMatchup.team} ({worstMatchup.stats.PRA.toFixed(1)} PRA)
          </span>
        )}
      </div>

      {/* Controls Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter team..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="pl-7 pr-2 py-1.5 text-xs rounded-md border border-border bg-background/50 focus:outline-none focus:ring-1 focus:ring-primary/50 w-[130px]"
          />
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground mr-0.5" />
          {sortOptions.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleSort(key)}
              className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                sortBy === key
                  ? "bg-primary/15 border-primary/30 text-primary font-medium"
                  : "border-border/50 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              {label}
              {sortBy === key && (
                <span className="ml-0.5">{sortDesc ? "↓" : "↑"}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Team Matchup Cards */}
      <div className="space-y-2">
        {displayedTeams.map(([team, stats]) => {
          const ptsDiff = getDiffIndicator(stats.PTS, seasonAvg.PTS);
          const rebDiff = getDiffIndicator(stats.REB, seasonAvg.REB);
          const astDiff = getDiffIndicator(stats.AST, seasonAvg.AST);
          const praDiff = getDiffIndicator(stats.PRA, seasonAvg.PRA);
          const perfBg = getPerformanceBg(stats.PRA, seasonAvg.PRA);

          return (
            <div
              key={team}
              className={`rounded-md p-3 border ${perfBg}`}
              data-testid={`vs-team-${team}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">vs {team}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {stats.games} {stats.games === 1 ? "game" : "games"}
                  </Badge>
                  {stats.wins !== undefined && stats.losses !== undefined && (
                    <span className="text-[10px] text-muted-foreground">
                      ({stats.wins}W-{stats.losses}L)
                    </span>
                  )}
                  {stats.lastGameDate && (
                    <span className="text-[10px] text-muted-foreground">
                      Last: {stats.lastGameDate}
                    </span>
                  )}
                </div>
                <div className={`text-sm font-mono font-semibold ${praDiff.color}`}>
                  {stats.PRA.toFixed(1)} PRA
                </div>
              </div>
              <div className="grid grid-cols-7 gap-2 text-xs">
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">PTS</div>
                  <div className="font-mono font-semibold">{stats.PTS.toFixed(1)}</div>
                  <div className={`text-[10px] ${ptsDiff.color}`}>{ptsDiff.text}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">REB</div>
                  <div className="font-mono font-semibold">{stats.REB.toFixed(1)}</div>
                  <div className={`text-[10px] ${rebDiff.color}`}>{rebDiff.text}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">AST</div>
                  <div className="font-mono font-semibold">{stats.AST.toFixed(1)}</div>
                  <div className={`text-[10px] ${astDiff.color}`}>{astDiff.text}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">3PM</div>
                  <div className="font-mono font-semibold">{stats.FG3M?.toFixed(1) ?? "-"}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">STL</div>
                  <div className="font-mono font-semibold">{stats.STL?.toFixed(1) ?? "-"}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">BLK</div>
                  <div className="font-mono font-semibold">{stats.BLK?.toFixed(1) ?? "-"}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground mb-0.5">TOV</div>
                  <div className="font-mono font-semibold">{stats.TOV?.toFixed(1) ?? "-"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Show All / Show Less Toggle */}
      {hasMore && !searchFilter && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-border/50 rounded-md hover:bg-muted/20 transition-colors flex items-center justify-center gap-1"
        >
          {showAll ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show Top 5
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Show All {teams.length} Teams
            </>
          )}
        </button>
      )}

      {/* No results from filter */}
      {searchFilter && teams.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">
          No teams matching "{searchFilter}"
        </div>
      )}
    </div>
  );
}
