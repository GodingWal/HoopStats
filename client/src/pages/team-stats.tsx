import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Users,
  Target,
  Clock,
  Award,
  ArrowUpDown,
  Flame,
  Snowflake,
  Home,
  Plane,
} from "lucide-react";
import type {
  TeamStats,
  TeamComparison,
  QuarterScoring,
  PlayerRotationStats,
  GameContext,
} from "@shared/schema";
import { InjuryImpact } from "@/components/injury-impact";

// NBA Team info type
interface TeamInfo {
  id: string;
  abbr: string;
  name: string;
  fullName: string;
  conference: string;
  division: string;
}

// Fetch functions
async function fetchTeams(): Promise<TeamInfo[]> {
  const response = await fetch('/api/teams');
  if (!response.ok) throw new Error('Failed to fetch teams');
  return response.json();
}

async function fetchTeamStats(teamAbbr: string): Promise<TeamStats> {
  const response = await fetch(`/api/teams/${teamAbbr}/stats`);
  if (!response.ok) throw new Error('Failed to fetch team stats');
  return response.json();
}

async function fetchTeamComparison(team1: string, team2: string): Promise<TeamComparison> {
  const response = await fetch(`/api/teams/compare/${team1}/${team2}`);
  if (!response.ok) throw new Error('Failed to compare teams');
  return response.json();
}

// Stat card component
function StatCard({
  label,
  value,
  subValue,
  trend,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ElementType;
}) {
  return (
    <div className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{value}</span>
        {trend && (
          trend === 'up' ? (
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          ) : trend === 'down' ? (
            <TrendingDown className="w-4 h-4 text-red-500" />
          ) : null
        )}
      </div>
      {subValue && (
        <span className="text-xs text-muted-foreground">{subValue}</span>
      )}
    </div>
  );
}

// Quarter scoring chart component
function QuarterScoringChart({
  scoring,
  oppScoring,
  title,
}: {
  scoring: QuarterScoring;
  oppScoring?: QuarterScoring;
  title: string;
}) {
  const data = [
    { quarter: 'Q1', team: scoring.q1, opponent: oppScoring?.q1 || 0 },
    { quarter: 'Q2', team: scoring.q2, opponent: oppScoring?.q2 || 0 },
    { quarter: 'Q3', team: scoring.q3, opponent: oppScoring?.q3 || 0 },
    { quarter: 'Q4', team: scoring.q4, opponent: oppScoring?.q4 || 0 },
  ];

  const halfData = [
    { half: '1st Half', team: scoring.firstHalf, opponent: oppScoring?.firstHalf || 0 },
    { half: '2nd Half', team: scoring.secondHalf, opponent: oppScoring?.secondHalf || 0 },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium mb-3">By Quarter</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="quarter" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Bar dataKey="team" name="Team" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                {oppScoring && (
                  <Bar dataKey="opponent" name="Opponent" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-3">By Half</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={halfData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="half" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Bar dataKey="team" name="Team" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                {oppScoring && (
                  <Bar dataKey="opponent" name="Opponent" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="text-center p-2 bg-muted/50 rounded">
            <div className="text-lg font-bold">{scoring.q1.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Q1 Avg</div>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <div className="text-lg font-bold">{scoring.q2.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Q2 Avg</div>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <div className="text-lg font-bold">{scoring.q3.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Q3 Avg</div>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <div className="text-lg font-bold">{scoring.q4.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Q4 Avg</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Rotation analysis component
function RotationAnalysis({
  rotation,
  closeGamesCount,
  blowoutsCount,
}: {
  rotation: PlayerRotationStats[];
  closeGamesCount: number;
  blowoutsCount: number;
}) {
  const [sortBy, setSortBy] = useState<'overall' | 'close' | 'blowout'>('overall');

  const sortedRotation = useMemo(() => {
    return [...rotation].sort((a, b) => {
      switch (sortBy) {
        case 'close':
          return b.closeGameMpg - a.closeGameMpg;
        case 'blowout':
          return b.blowoutMpg - a.blowoutMpg;
        default:
          return b.overallMpg - a.overallMpg;
      }
    });
  }, [rotation, sortBy]);

  const starters = sortedRotation.filter(p => p.isStarter);
  const bench = sortedRotation.filter(p => !p.isStarter);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Rotation Analysis</CardTitle>
            <CardDescription>
              Minutes distribution: Close Games ({closeGamesCount}) vs Blowouts ({blowoutsCount})
            </CardDescription>
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overall">Overall MPG</SelectItem>
              <SelectItem value="close">Close Game MPG</SelectItem>
              <SelectItem value="blowout">Blowout MPG</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Starters */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Starters
            </h4>
            <div className="space-y-3">
              {starters.slice(0, 5).map((player) => (
                <PlayerRotationRow key={player.playerId} player={player} />
              ))}
            </div>
          </div>

          <Separator />

          {/* Bench */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Bench
            </h4>
            <div className="space-y-3">
              {bench.slice(0, 8).map((player) => (
                <PlayerRotationRow key={player.playerId} player={player} />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PlayerRotationRow({ player }: { player: PlayerRotationStats }) {
  const closeVsBlowout = player.closeGameMpg - player.blowoutMpg;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{player.playerName}</span>
          {player.position && (
            <Badge variant="outline" className="text-xs">
              {player.position}
            </Badge>
          )}
          {player.isStarter && (
            <Badge className="text-xs bg-primary/20 text-primary">Starter</Badge>
          )}
        </div>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
          <span>{player.overallPpg.toFixed(1)} PPG</span>
          <span>{player.overallRpg.toFixed(1)} RPG</span>
          <span>{player.overallApg.toFixed(1)} APG</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-sm font-bold">{player.overallMpg.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">Overall</div>
        </div>
        <div>
          <div className="text-sm font-bold text-amber-500">{player.closeGameMpg.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">Close</div>
        </div>
        <div>
          <div className="text-sm font-bold text-blue-500">{player.blowoutMpg.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">Blowout</div>
        </div>
      </div>
      <div className="w-20 text-right">
        <div className={`text-sm font-medium ${closeVsBlowout > 0 ? 'text-amber-500' : 'text-blue-500'}`}>
          {closeVsBlowout > 0 ? '+' : ''}{closeVsBlowout.toFixed(1)}
        </div>
        <div className="text-xs text-muted-foreground">Diff</div>
      </div>
    </div>
  );
}

// Recent games table component
function RecentGamesTable({ games }: { games: GameContext[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Games</CardTitle>
        <CardDescription>Quarter-by-quarter breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Opp</th>
                <th className="text-center py-2 px-3">Result</th>
                <th className="text-center py-2 px-3">Q1</th>
                <th className="text-center py-2 px-3">Q2</th>
                <th className="text-center py-2 px-3">Q3</th>
                <th className="text-center py-2 px-3">Q4</th>
                <th className="text-center py-2 px-3">1H</th>
                <th className="text-center py-2 px-3">2H</th>
                <th className="text-center py-2 px-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.gameId} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3 text-muted-foreground">
                    {new Date(game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      {game.isHome ? (
                        <Home className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <Plane className="w-3 h-3 text-muted-foreground" />
                      )}
                      {game.opponent}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <Badge
                      variant={game.result === 'W' ? 'default' : 'destructive'}
                      className={game.result === 'W' ? 'bg-emerald-500/20 text-emerald-500' : ''}
                    >
                      {game.result} {game.finalScore}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-center">{game.quarterScoring.q1}</td>
                  <td className="py-2 px-3 text-center">{game.quarterScoring.q2}</td>
                  <td className="py-2 px-3 text-center">{game.quarterScoring.q3}</td>
                  <td className="py-2 px-3 text-center">{game.quarterScoring.q4}</td>
                  <td className="py-2 px-3 text-center font-medium">{game.quarterScoring.firstHalf}</td>
                  <td className="py-2 px-3 text-center font-medium">{game.quarterScoring.secondHalf}</td>
                  <td className="py-2 px-3 text-center">
                    <Badge variant="outline" className="text-xs">
                      {game.gameType.replace('_', ' ')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// Advanced stats radar chart
function AdvancedStatsRadar({ stats }: { stats: TeamStats['advancedStats'] }) {
  if (!stats) return null;

  const data = [
    { stat: 'Off Rating', value: (stats.offRating / 120) * 100, fullMark: 100 },
    { stat: 'Def Rating', value: (1 - (stats.defRating - 100) / 20) * 100, fullMark: 100 },
    { stat: 'Pace', value: (stats.pace / 110) * 100, fullMark: 100 },
    { stat: 'eFG%', value: stats.efgPct * 100, fullMark: 100 },
    { stat: 'TOV%', value: (1 - stats.tovPct / 20) * 100, fullMark: 100 },
    { stat: 'ORB%', value: stats.orbPct * 200, fullMark: 100 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Advanced Stats Profile</CardTitle>
        <CardDescription>Team efficiency metrics (normalized)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={data}>
            <PolarGrid className="stroke-muted" />
            <PolarAngleAxis dataKey="stat" className="text-xs" />
            <PolarRadiusAxis angle={30} domain={[0, 100]} className="text-xs" />
            <Radar
              name="Team"
              dataKey="value"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground">Off Rating</div>
            <div className="text-lg font-bold">{stats.offRating.toFixed(1)}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground">Def Rating</div>
            <div className="text-lg font-bold">{stats.defRating.toFixed(1)}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground">Net Rating</div>
            <div className={`text-lg font-bold ${stats.netRating > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {stats.netRating > 0 ? '+' : ''}{stats.netRating.toFixed(1)}
            </div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground">Pace</div>
            <div className="text-lg font-bold">{stats.pace.toFixed(1)}</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground">eFG%</div>
            <div className="text-lg font-bold">{(stats.efgPct * 100).toFixed(1)}%</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-xs text-muted-foreground">True Shooting</div>
            <div className="text-lg font-bold">{(stats.tsPct * 100).toFixed(1)}%</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Player comparison table for team matchups
function PlayerComparisonTable({ comparison }: { comparison: TeamComparison }) {
  const { team1, team2 } = comparison;

  // Get top players sorted by minutes, limit to 8 per team
  const team1Players = [...team1.rotation]
    .sort((a, b) => b.overallMpg - a.overallMpg)
    .slice(0, 8);
  const team2Players = [...team2.rotation]
    .sort((a, b) => b.overallMpg - a.overallMpg)
    .slice(0, 8);

  // Ensure we have enough rows (max of both teams)
  const maxRows = Math.max(team1Players.length, team2Players.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player Comparison</CardTitle>
        <CardDescription>
          Top rotation players by minutes - season averages
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* Team 1 Players */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-center bg-primary/10 py-2 rounded-t-lg">
              {team1.teamAbbr}
            </h4>
            <div className="space-y-2">
              {team1Players.map((player) => (
                <div
                  key={player.playerId}
                  className="flex items-center justify-between p-2 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{player.playerName}</span>
                      {player.isStarter && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">S</Badge>
                      )}
                    </div>
                    {player.position && (
                      <span className="text-xs text-muted-foreground">{player.position}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <div className="font-semibold text-blue-500">{player.overallMpg.toFixed(1)}</div>
                      <div className="text-muted-foreground">MIN</div>
                    </div>
                    <div>
                      <div className="font-semibold">{player.overallPpg.toFixed(1)}</div>
                      <div className="text-muted-foreground">PTS</div>
                    </div>
                    <div>
                      <div className="font-semibold">{player.overallRpg.toFixed(1)}</div>
                      <div className="text-muted-foreground">REB</div>
                    </div>
                    <div>
                      <div className="font-semibold">{player.overallApg.toFixed(1)}</div>
                      <div className="text-muted-foreground">AST</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Team 2 Players */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-center bg-muted/50 py-2 rounded-t-lg">
              {team2.teamAbbr}
            </h4>
            <div className="space-y-2">
              {team2Players.map((player) => (
                <div
                  key={player.playerId}
                  className="flex items-center justify-between p-2 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{player.playerName}</span>
                      {player.isStarter && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">S</Badge>
                      )}
                    </div>
                    {player.position && (
                      <span className="text-xs text-muted-foreground">{player.position}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <div className="font-semibold text-blue-500">{player.overallMpg.toFixed(1)}</div>
                      <div className="text-muted-foreground">MIN</div>
                    </div>
                    <div>
                      <div className="font-semibold">{player.overallPpg.toFixed(1)}</div>
                      <div className="text-muted-foreground">PTS</div>
                    </div>
                    <div>
                      <div className="font-semibold">{player.overallRpg.toFixed(1)}</div>
                      <div className="text-muted-foreground">REB</div>
                    </div>
                    <div>
                      <div className="font-semibold">{player.overallApg.toFixed(1)}</div>
                      <div className="text-muted-foreground">AST</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Team comparison component
function TeamComparisonView({ comparison }: { comparison: TeamComparison }) {
  const { team1, team2, headToHead } = comparison;

  const comparisonData = [
    { stat: 'PPG', team1: team1.basicStats.ppg, team2: team2.basicStats.ppg },
    { stat: 'Opp PPG', team1: team1.basicStats.oppPpg, team2: team2.basicStats.oppPpg },
    { stat: 'Win %', team1: team1.basicStats.winPct * 100, team2: team2.basicStats.winPct * 100 },
    { stat: 'FG %', team1: team1.basicStats.fgPct * 100, team2: team2.basicStats.fgPct * 100 },
    { stat: '3P %', team1: team1.basicStats.fg3Pct * 100, team2: team2.basicStats.fg3Pct * 100 },
  ];

  return (
    <div className="space-y-6">
      {/* Head-to-head summary */}
      {headToHead && headToHead.recentGames.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Head-to-Head</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div>
                <div className="text-2xl font-bold text-primary">{headToHead.team1Wins}</div>
                <div className="text-sm text-muted-foreground">{team1.teamAbbr} Wins</div>
              </div>
              <div>
                <div className="text-lg text-muted-foreground">vs</div>
                <div className="text-xs">Avg Diff: {headToHead.avgPointDiff.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{headToHead.team2Wins}</div>
                <div className="text-sm text-muted-foreground">{team2.teamAbbr} Wins</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Stats Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={comparisonData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" className="text-xs" />
              <YAxis dataKey="stat" type="category" className="text-xs" width={80} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="team1" name={team1.teamAbbr} fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              <Bar dataKey="team2" name={team2.teamAbbr} fill="hsl(var(--muted-foreground))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Detailed comparison table */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3">Stat</th>
                  <th className="text-center py-2 px-3">{team1.teamAbbr}</th>
                  <th className="text-center py-2 px-3">{team2.teamAbbr}</th>
                  <th className="text-center py-2 px-3">Edge</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">Record</td>
                  <td className="py-2 px-3 text-center">{team1.basicStats.wins}-{team1.basicStats.losses}</td>
                  <td className="py-2 px-3 text-center">{team2.basicStats.wins}-{team2.basicStats.losses}</td>
                  <td className="py-2 px-3 text-center">
                    {team1.basicStats.winPct > team2.basicStats.winPct ? team1.teamAbbr : team2.teamAbbr}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">PPG</td>
                  <td className="py-2 px-3 text-center">{team1.basicStats.ppg.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">{team2.basicStats.ppg.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">
                    {team1.basicStats.ppg > team2.basicStats.ppg ? team1.teamAbbr : team2.teamAbbr}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">Opp PPG</td>
                  <td className="py-2 px-3 text-center">{team1.basicStats.oppPpg.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">{team2.basicStats.oppPpg.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">
                    {team1.basicStats.oppPpg < team2.basicStats.oppPpg ? team1.teamAbbr : team2.teamAbbr}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">1st Half PPG</td>
                  <td className="py-2 px-3 text-center">{team1.basicStats.avgQuarterScoring.firstHalf.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">{team2.basicStats.avgQuarterScoring.firstHalf.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">
                    {team1.basicStats.avgQuarterScoring.firstHalf > team2.basicStats.avgQuarterScoring.firstHalf ? team1.teamAbbr : team2.teamAbbr}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">2nd Half PPG</td>
                  <td className="py-2 px-3 text-center">{team1.basicStats.avgQuarterScoring.secondHalf.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">{team2.basicStats.avgQuarterScoring.secondHalf.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center">
                    {team1.basicStats.avgQuarterScoring.secondHalf > team2.basicStats.avgQuarterScoring.secondHalf ? team1.teamAbbr : team2.teamAbbr}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">Streak</td>
                  <td className="py-2 px-3 text-center">
                    {team1.streak && (
                      <span className={team1.streak.type === 'W' ? 'text-emerald-500' : 'text-red-500'}>
                        {team1.streak.type}{team1.streak.count}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {team2.streak && (
                      <span className={team2.streak.type === 'W' ? 'text-emerald-500' : 'text-red-500'}>
                        {team2.streak.type}{team2.streak.count}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Player Comparison */}
      <PlayerComparisonTable comparison={comparison} />
    </div>
  );
}

// Main page component
export default function TeamStatsPage() {
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [compareTeam, setCompareTeam] = useState<string>('');
  const [isComparing, setIsComparing] = useState(false);
  const [selectedInjuredPlayer, setSelectedInjuredPlayer] = useState<{ id: number; name: string } | null>(null);

  // Fetch teams list
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
  });

  // Fetch selected team stats
  const { data: teamStats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['team-stats', selectedTeam],
    queryFn: () => fetchTeamStats(selectedTeam),
    enabled: !!selectedTeam,
  });

  // Fetch comparison data
  const { data: comparisonData, isLoading: comparisonLoading } = useQuery({
    queryKey: ['team-comparison', selectedTeam, compareTeam],
    queryFn: () => fetchTeamComparison(selectedTeam, compareTeam),
    enabled: isComparing && !!selectedTeam && !!compareTeam,
  });

  // Calculate close games vs blowouts for rotation
  const closeGamesCount = teamStats?.recentGames.filter(
    g => g.gameType === 'close_win' || g.gameType === 'close_loss'
  ).length || 0;
  const blowoutsCount = teamStats?.recentGames.filter(
    g => g.gameType === 'blowout_win' || g.gameType === 'blowout_loss'
  ).length || 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Team Stats</h1>
          <p className="text-muted-foreground">
            Comprehensive team analytics with quarter/half scoring and rotation analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedTeam} onValueChange={(v) => { setSelectedTeam(v); setIsComparing(false); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {teams?.map((team) => (
                <SelectItem key={team.abbr} value={team.abbr}>
                  {team.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedTeam && (
            <>
              <Button
                variant={isComparing ? "default" : "outline"}
                onClick={() => setIsComparing(!isComparing)}
              >
                <ArrowUpDown className="w-4 h-4 mr-2" />
                Compare
              </Button>

              {isComparing && (
                <Select value={compareTeam} onValueChange={setCompareTeam}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Compare with..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teams?.filter(t => t.abbr !== selectedTeam).map((team) => (
                      <SelectItem key={team.abbr} value={team.abbr}>
                        {team.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
        </div>
      </div>

      {/* Loading state */}
      {(teamsLoading || statsLoading) && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!selectedTeam && !teamsLoading && (
        <Card className="p-12 text-center">
          <div className="max-w-md mx-auto">
            <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Select a Team</h2>
            <p className="text-muted-foreground mb-4">
              Choose a team to view comprehensive stats including quarter scoring, rotation analysis, and advanced metrics.
            </p>
          </div>
        </Card>
      )}

      {/* Comparison view */}
      {isComparing && comparisonData && !comparisonLoading && (
        <TeamComparisonView comparison={comparisonData} />
      )}

      {/* Team stats view */}
      {teamStats && !isComparing && (
        <>
          {/* Team header */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">{teamStats.teamAbbr}</span>
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-bold">{teamStats.teamName}</h2>
                  <p className="text-muted-foreground">
                    {teamStats.conference} Conference • {teamStats.division} Division
                  </p>
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">{teamStats.basicStats.wins}-{teamStats.basicStats.losses}</div>
                    <div className="text-xs text-muted-foreground">Record</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{teamStats.last10}</div>
                    <div className="text-xs text-muted-foreground">Last 10</div>
                  </div>
                  {teamStats.streak && (
                    <div>
                      <div className={`text-2xl font-bold flex items-center gap-1 ${teamStats.streak.type === 'W' ? 'text-emerald-500' : 'text-red-500'}`}>
                        {teamStats.streak.type === 'W' ? <Flame className="w-5 h-5" /> : <Snowflake className="w-5 h-5" />}
                        {teamStats.streak.count}
                      </div>
                      <div className="text-xs text-muted-foreground">Streak</div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <StatCard
              label="Points Per Game"
              value={teamStats.basicStats.ppg.toFixed(1)}
              icon={Target}
            />
            <StatCard
              label="Opp PPG"
              value={teamStats.basicStats.oppPpg.toFixed(1)}
              icon={Target}
            />
            <StatCard
              label="FG%"
              value={`${(teamStats.basicStats.fgPct * 100).toFixed(1)}%`}
            />
            <StatCard
              label="3P%"
              value={`${(teamStats.basicStats.fg3Pct * 100).toFixed(1)}%`}
            />
            <StatCard
              label="Home PPG"
              value={teamStats.basicStats.homePpg.toFixed(1)}
              subValue={teamStats.basicStats.homeRecord}
              icon={Home}
            />
            <StatCard
              label="Away PPG"
              value={teamStats.basicStats.awayPpg.toFixed(1)}
              subValue={teamStats.basicStats.awayRecord}
              icon={Plane}
            />
          </div>

          {/* Tabs for different views */}
          <Tabs defaultValue="scoring" className="space-y-4">
            <TabsList>
              <TabsTrigger value="scoring">Quarter Scoring</TabsTrigger>
              <TabsTrigger value="rotation">Rotation</TabsTrigger>
              <TabsTrigger value="injuries">Injury Impact</TabsTrigger>
              <TabsTrigger value="games">Recent Games</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="scoring">
              <QuarterScoringChart
                scoring={teamStats.basicStats.avgQuarterScoring}
                oppScoring={teamStats.basicStats.oppAvgQuarterScoring}
                title="Average Scoring by Quarter & Half"
              />
            </TabsContent>

            <TabsContent value="rotation">
              <RotationAnalysis
                rotation={teamStats.rotation}
                closeGamesCount={closeGamesCount}
                blowoutsCount={blowoutsCount}
              />
            </TabsContent>

            <TabsContent value="injuries">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Select Injured Player</CardTitle>
                  <CardDescription>
                    Choose a player to see how teammates perform when they sit out
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Select
                    value={selectedInjuredPlayer?.id.toString() || ''}
                    onValueChange={(value) => {
                      const player = teamStats.rotation.find(p => p.playerId.toString() === value);
                      if (player) {
                        setSelectedInjuredPlayer({ id: player.playerId, name: player.playerName });
                      }
                    }}
                  >
                    <SelectTrigger className="w-full md:w-[300px]">
                      <SelectValue placeholder="Select a player..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teamStats.rotation
                        .filter(p => p.isStarter) // Only show starters
                        .sort((a, b) => b.overallPpg - a.overallPpg)
                        .map((player) => (
                          <SelectItem key={player.playerId} value={player.playerId.toString()}>
                            {player.playerName} ({player.overallPpg.toFixed(1)} PPG)
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {selectedInjuredPlayer && (
                <div className="mt-4">
                  <InjuryImpact
                    injuredPlayerId={selectedInjuredPlayer.id}
                    injuredPlayerName={selectedInjuredPlayer.name}
                    team={teamStats.teamAbbr}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="games">
              <RecentGamesTable games={teamStats.recentGames} />
            </TabsContent>

            <TabsContent value="advanced">
              <AdvancedStatsRadar stats={teamStats.advancedStats} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
