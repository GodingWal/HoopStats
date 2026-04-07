import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Cell,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  Shield,
  Swords,
  Home,
  Plane,
  Flame,
  Snowflake,
  BarChart3,
  ArrowRight,
  Brain,
  Activity,
  Trophy,
  Calendar,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  Tv2,
} from "lucide-react";

interface TeamInfo {
  id: string;
  abbr: string;
  name: string;
  fullName: string;
  conference: string;
  division: string;
}

interface PredictionTeam {
  abbr: string;
  name: string;
  winProb: number;
  projectedScore: number;
  record: string;
  streak: { type: string; count: number };
  last10: string;
  ppg: number;
  oppPpg: number;
  offRating: number;
  defRating: number;
  netRating: number;
}

interface FeatureImportanceItem {
  feature: string;
  weight: number;
  team1Value: any;
  team2Value: any;
  differential: number;
  contribution: number;
  favors: string;
}

interface StatComparison {
  label: string;
  team1: string;
  team2: string;
  better: 1 | 2;
}

interface PredictionResult {
  team1: PredictionTeam;
  team2: PredictionTeam;
  prediction: {
    winner: string;
    winnerName: string;
    winProb: number;
    confidence: number;
    projectedTotal: number;
    projectedSpread: number;
    homeTeam: string;
    modelInfo: {
      type: string;
      features: number;
      description: string;
    };
  };
  featureImportance: FeatureImportanceItem[];
  comparison: {
    stats: StatComparison[];
    quarterScoring: {
      team1: { q1: number; q2: number; q3: number; q4: number; firstHalf: number; secondHalf: number };
      team2: { q1: number; q2: number; q3: number; q4: number; firstHalf: number; secondHalf: number };
    };
  };
}

interface TodayGamePrediction {
  team1: { abbr: string; name: string; winProb: number; projectedScore: number; ppg: number; };
  team2: { abbr: string; name: string; winProb: number; projectedScore: number; ppg: number; };
  prediction: { winner: string; winnerName: string; winProb: number; confidence: number; projectedTotal: number; projectedSpread: number; homeTeam: string; modelInfo: { type: string; features: number; description: string; }; };
  featureImportance: Array<{ feature: string; contribution: number; favors: string; team1Value: any; team2Value: any; }>;
  comparison: { stats: StatComparison[]; quarterScoring: any; };
}

interface TodayGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  status: string; // "pre", "in", "post"
  homeScore: number | null;
  awayScore: number | null;
  venue: string;
  broadcast: string;
  prediction: TodayGamePrediction | null;
  predictionCorrect: boolean | null;
}

// Team colors for visual differentiation
const TEAM_COLORS: Record<string, string> = {
  ATL: "#E03A3E", BOS: "#007A33", BKN: "#000000", CHA: "#1D1160",
  CHI: "#CE1141", CLE: "#860038", DAL: "#00538C", DEN: "#0E2240",
  DET: "#C8102E", GSW: "#1D428A", HOU: "#CE1141", IND: "#002D62",
  LAC: "#C8102E", LAL: "#552583", MEM: "#5D76A9", MIA: "#98002E",
  MIL: "#00471B", MIN: "#0C2340", NOP: "#0C2340", NYK: "#006BB6",
  OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHX: "#1D1160",
  POR: "#E03A3E", SAC: "#5A2D81", SAS: "#C4CED4", TOR: "#CE1141",
  UTA: "#002B5C", WAS: "#002B5C",
};

function getTeamColor(abbr: string) {
  return TEAM_COLORS[abbr] || "hsl(var(--primary))";
}

export default function TeamsPage() {
  const [team1, setTeam1] = useState<string>("");
  const [team2, setTeam2] = useState<string>("");
  const [homeTeam, setHomeTeam] = useState<string>("");
  const [shouldPredict, setShouldPredict] = useState(false);

  // Today's games state
  const [todayGames, setTodayGames] = useState<TodayGame[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  const { data: teams, isLoading: teamsLoading } = useQuery<TeamInfo[]>({
    queryKey: ["/api/teams"],
  });

  // Fetch today's games on mount
  useEffect(() => {
    async function fetchTodayGames() {
      setTodayLoading(true);
      setTodayError(null);
      try {
        const res = await fetch("/api/teams/today");
        if (!res.ok) throw new Error("Failed to fetch today's games");
        const data = await res.json();
        setTodayGames(data.games || []);
      } catch (err: any) {
        setTodayError(err.message || "Unknown error");
      } finally {
        setTodayLoading(false);
      }
    }
    fetchTodayGames();
  }, []);

  const { data: prediction, isLoading: predicting, error: predictionError } = useQuery<PredictionResult>({
    queryKey: ["/api/teams/predict", team1, team2, homeTeam],
    queryFn: async () => {
      const url = `/api/teams/predict/${team1}/${team2}${homeTeam ? `?home=${homeTeam}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to get prediction");
      return res.json();
    },
    enabled: shouldPredict && !!team1 && !!team2 && team1 !== team2,
  });

  const handlePredict = () => {
    if (team1 && team2 && team1 !== team2) {
      setShouldPredict(true);
    }
  };

  const handleTeamChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setShouldPredict(false);
  };

  // Group teams by conference
  const teamsByConference = useMemo(() => {
    if (!teams) return { Eastern: [], Western: [] };
    return {
      Eastern: teams.filter(t => t.conference === "Eastern").sort((a, b) => a.fullName.localeCompare(b.fullName)),
      Western: teams.filter(t => t.conference === "Western").sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
  }, [teams]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Game Predictor</h1>
            <p className="text-sm text-muted-foreground">
              ML-powered game outcome predictions using 17+ statistical features
            </p>
          </div>
        </div>
      </div>

      {/* Today's Games Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Today's NBA Games</h2>
          <Badge variant="outline" className="text-xs">
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </Badge>
        </div>

        {todayLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="py-4">
                  <div className="h-5 bg-muted rounded w-3/4 mb-3" />
                  <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                  <div className="h-2 bg-muted rounded w-full mb-1" />
                  <div className="h-4 bg-muted rounded w-2/3 mt-3" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!todayLoading && todayError && (
          <Card className="border-destructive/30">
            <CardContent className="py-6 text-center">
              <p className="text-destructive text-sm font-medium">Could not load today's games</p>
              <p className="text-xs text-muted-foreground mt-1">{todayError}</p>
            </CardContent>
          </Card>
        )}

        {!todayLoading && !todayError && todayGames.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No NBA games scheduled for today.</p>
            </CardContent>
          </Card>
        )}

        {!todayLoading && !todayError && todayGames.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {todayGames.map((game) => (
              <TodayGameCard
                key={game.gameId}
                game={game}
                isExpanded={expandedGame === game.gameId}
                onToggle={() => setExpandedGame(expandedGame === game.gameId ? null : game.gameId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Team Selection */}
      <Card className="border-primary/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Swords className="w-5 h-5 text-primary" />
            Select Matchup
          </CardTitle>
          <CardDescription>Choose two teams to predict the game outcome</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
            {/* Team 1 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Team 1</label>
              <Select value={team1} onValueChange={(v) => handleTeamChange(setTeam1, v)}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Eastern Conference</div>
                  {teamsByConference.Eastern.map((t) => (
                    <SelectItem key={t.abbr} value={t.abbr} disabled={t.abbr === team2}>
                      <span className="font-medium">{t.abbr}</span>
                      <span className="ml-2 text-muted-foreground">{t.fullName}</span>
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">Western Conference</div>
                  {teamsByConference.Western.map((t) => (
                    <SelectItem key={t.abbr} value={t.abbr} disabled={t.abbr === team2}>
                      <span className="font-medium">{t.abbr}</span>
                      <span className="ml-2 text-muted-foreground">{t.fullName}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* VS Divider */}
            <div className="flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">VS</span>
              </div>
            </div>

            {/* Team 2 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Team 2</label>
              <Select value={team2} onValueChange={(v) => handleTeamChange(setTeam2, v)}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Eastern Conference</div>
                  {teamsByConference.Eastern.map((t) => (
                    <SelectItem key={t.abbr} value={t.abbr} disabled={t.abbr === team1}>
                      <span className="font-medium">{t.abbr}</span>
                      <span className="ml-2 text-muted-foreground">{t.fullName}</span>
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">Western Conference</div>
                  {teamsByConference.Western.map((t) => (
                    <SelectItem key={t.abbr} value={t.abbr} disabled={t.abbr === team1}>
                      <span className="font-medium">{t.abbr}</span>
                      <span className="ml-2 text-muted-foreground">{t.fullName}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Home Team Selection + Predict Button */}
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 mt-4">
            <div className="space-y-2 flex-1">
              <label className="text-sm font-medium text-muted-foreground">Home Team (optional)</label>
              <Select value={homeTeam} onValueChange={(v) => { setHomeTeam(v); setShouldPredict(false); }}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Neutral court" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="neutral">Neutral Court</SelectItem>
                  {team1 && <SelectItem value={team1}>{teams?.find(t => t.abbr === team1)?.fullName || team1} (Home)</SelectItem>}
                  {team2 && <SelectItem value={team2}>{teams?.find(t => t.abbr === team2)?.fullName || team2} (Home)</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="lg"
              className="h-10 px-8 font-semibold"
              onClick={handlePredict}
              disabled={!team1 || !team2 || team1 === team2 || predicting}
            >
              {predicting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Predict Game
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {predicting && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <Brain className="w-5 h-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <div className="text-center">
              <p className="font-semibold">Running Prediction Model</p>
              <p className="text-sm text-muted-foreground">Analyzing 17+ statistical features...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {predictionError && (
        <Card className="border-destructive/50">
          <CardContent className="py-8 text-center">
            <p className="text-destructive font-medium">Failed to generate prediction</p>
            <p className="text-sm text-muted-foreground mt-1">Please try again or select different teams</p>
          </CardContent>
        </Card>
      )}

      {/* Prediction Results */}
      {prediction && !predicting && (
        <div className="space-y-6">
          {/* Main Prediction Card */}
          <PredictionHeader prediction={prediction} />

          <Tabs defaultValue="breakdown" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
              <TabsTrigger value="stats">Head-to-Head</TabsTrigger>
              <TabsTrigger value="scoring">Scoring</TabsTrigger>
            </TabsList>

            <TabsContent value="breakdown">
              <PredictionBreakdown prediction={prediction} />
            </TabsContent>

            <TabsContent value="features">
              <FeatureImportancePanel prediction={prediction} />
            </TabsContent>

            <TabsContent value="stats">
              <HeadToHeadStats prediction={prediction} />
            </TabsContent>

            <TabsContent value="scoring">
              <ScoringAnalysis prediction={prediction} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Empty State */}
      {!prediction && !predicting && !predictionError && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="p-4 rounded-full bg-muted">
              <Swords className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg">Select Two Teams</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Choose any two NBA teams above to generate an ML-powered prediction
                based on rolling averages, efficiency ratings, and recent form.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ==================== Subcomponents ====================

function formatGameTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  } catch {
    return isoString;
  }
}

function TodayGameCard({
  game,
  isExpanded,
  onToggle,
}: {
  game: TodayGame;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const pred = game.prediction;
  const awayColor = getTeamColor(game.awayTeam);
  const homeColor = getTeamColor(game.homeTeam);

  // Which team is favored (from pred perspective: pred.team1 = away, pred.team2 = home)
  const awayWinProb = pred?.team1?.winProb ?? 50;
  const homeWinProb = pred?.team2?.winProb ?? 50;
  const projAwayScore = pred?.team1?.projectedScore ?? null;
  const projHomeScore = pred?.team2?.projectedScore ?? null;

  const confidence = pred?.prediction?.confidence ?? 0;
  const confidenceLabel = confidence >= 60 ? "High" : confidence >= 40 ? "Medium" : "Low";
  const confidenceClass = confidence >= 60
    ? "border-emerald-500/40 text-emerald-500"
    : confidence >= 40
    ? "border-amber-500/40 text-amber-500"
    : "border-muted-foreground/40 text-muted-foreground";

  const spread = pred?.prediction?.projectedSpread ?? null; // positive = away team (team1) favored
  const ou = pred?.prediction?.projectedTotal ?? null;
  const predictedWinner = pred?.prediction?.winner ?? null;

  // Top 2 factors by absolute contribution
  const topFactors = pred?.featureImportance
    ?.slice()
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2) ?? [];

  const statusBadge = game.status === "in" ? (
    <Badge className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">LIVE</Badge>
  ) : game.status === "post" ? (
    <Badge variant="outline" className="text-xs text-muted-foreground">Final</Badge>
  ) : (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="w-3 h-3" />
      {formatGameTime(game.gameTime)}
    </span>
  );

  return (
    <Card className="overflow-hidden border-border/60 hover:border-primary/30 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header: Matchup + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            {/* Away @ Home */}
            <div className="flex items-center gap-1.5 text-base font-bold">
              <span style={{ color: awayColor }}>{game.awayTeam}</span>
              <span className="text-muted-foreground text-xs font-normal">@</span>
              <span style={{ color: homeColor }}>{game.homeTeam}</span>
            </div>
            {game.venue && (
              <p className="text-xs text-muted-foreground truncate max-w-[180px]">{game.venue}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            {statusBadge}
            {game.broadcast && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Tv2 className="w-3 h-3" />
                {game.broadcast}
              </span>
            )}
          </div>
        </div>

        {/* Live / Final score */}
        {(game.status === "in" || game.status === "post") && game.awayScore !== null && game.homeScore !== null && (
          <div className="flex items-center justify-center gap-4 py-1.5 px-3 bg-muted/50 rounded-lg">
            <span className="text-lg font-bold tabular-nums" style={{ color: awayColor }}>{game.awayScore}</span>
            <span className="text-xs text-muted-foreground font-medium">
              {game.status === "post" ? "FINAL" : "LIVE"}
            </span>
            <span className="text-lg font-bold tabular-nums" style={{ color: homeColor }}>{game.homeScore}</span>
          </div>
        )}

        {pred && (
          <>
            {/* Win probability bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium">
                <span style={{ color: awayColor }}>{game.awayTeam} {awayWinProb}%</span>
                <span style={{ color: homeColor }}>{homeWinProb}% {game.homeTeam}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden bg-muted flex">
                <div className="h-full rounded-l-full transition-all duration-700" style={{ width: `${awayWinProb}%`, backgroundColor: awayColor }} />
                <div className="h-full rounded-r-full transition-all duration-700" style={{ width: `${homeWinProb}%`, backgroundColor: homeColor }} />
              </div>
            </div>

            {/* Projected score + betting lines */}
            {projAwayScore !== null && projHomeScore !== null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Proj: <span className="font-semibold text-foreground">{game.awayTeam} {projAwayScore} – {projHomeScore} {game.homeTeam}</span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {spread !== null && (
                <Badge variant="outline" className="text-xs font-mono">
                  {spread > 0 ? `${game.awayTeam} -${Math.abs(spread)}` : `${game.homeTeam} -${Math.abs(spread)}`}
                </Badge>
              )}
              {ou !== null && (
                <Badge variant="outline" className="text-xs font-mono">O/U {ou}</Badge>
              )}
              <Badge variant="outline" className={`text-xs ${confidenceClass}`}>
                {confidenceLabel} Conf
              </Badge>
              {game.status === "post" && game.predictionCorrect !== null && (
                game.predictionCorrect ? (
                  <span className="flex items-center gap-0.5 text-xs text-emerald-500">
                    <CheckCircle2 className="w-3 h-3" /> Correct
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 text-xs text-red-500">
                    <XCircle className="w-3 h-3" /> Incorrect
                  </span>
                )
              )}
            </div>

            {/* Top 2 key factors */}
            {topFactors.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border/40">
                <p className="text-xs text-muted-foreground font-medium">Key Factors</p>
                {topFactors.map((f) => {
                  const favoredTeam = f.favors === pred.team1.abbr ? game.awayTeam : f.favors === pred.team2.abbr ? game.homeTeam : null;
                  const favorColor = favoredTeam === game.awayTeam ? awayColor : favoredTeam === game.homeTeam ? homeColor : undefined;
                  return (
                    <div key={f.feature} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{f.feature}</span>
                      {favoredTeam && (
                        <span className="font-medium" style={{ color: favorColor }}>{favoredTeam}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Expand / collapse */}
            <button
              onClick={onToggle}
              className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1 border-t border-border/30"
            >
              {isExpanded ? (
                <><ChevronUp className="w-3 h-3" /> Hide Details</>
              ) : (
                <><ChevronDown className="w-3 h-3" /> Full Prediction</>
              )}
            </button>

            {/* Expanded: full prediction details */}
            {isExpanded && (
              <div className="pt-2 border-t border-border/40 space-y-4">
                <PredictionHeader prediction={pred as unknown as PredictionResult} />
                <Tabs defaultValue="breakdown" className="space-y-3">
                  <TabsList className="grid w-full grid-cols-3 h-8 text-xs">
                    <TabsTrigger value="breakdown" className="text-xs">Breakdown</TabsTrigger>
                    <TabsTrigger value="features" className="text-xs">Features</TabsTrigger>
                    <TabsTrigger value="stats" className="text-xs">Stats</TabsTrigger>
                  </TabsList>
                  <TabsContent value="breakdown">
                    <PredictionBreakdown prediction={pred as unknown as PredictionResult} />
                  </TabsContent>
                  <TabsContent value="features">
                    <FeatureImportancePanel prediction={pred as unknown as PredictionResult} />
                  </TabsContent>
                  <TabsContent value="stats">
                    <HeadToHeadStats prediction={pred as unknown as PredictionResult} />
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </>
        )}

        {!pred && (
          <p className="text-xs text-muted-foreground text-center py-2">Prediction unavailable</p>
        )}
      </CardContent>
    </Card>
  );
}

function PredictionHeader({ prediction }: { prediction: PredictionResult }) {
  const { team1, team2, prediction: pred } = prediction;
  const winner = pred.winner === team1.abbr ? team1 : team2;
  const loser = pred.winner === team1.abbr ? team2 : team1;

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5" />

        <CardContent className="relative py-6">
          {/* Score & Probability */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 md:gap-8 items-center">
            {/* Team 1 */}
            <TeamScorePanel
              team={team1}
              isWinner={pred.winner === team1.abbr}
              isHome={pred.homeTeam === team1.abbr}
            />

            {/* Center: Prediction */}
            <div className="text-center space-y-2">
              <Badge
                variant={pred.confidence >= 60 ? "default" : "secondary"}
                className="text-xs"
              >
                {pred.confidence >= 70 ? "High" : pred.confidence >= 40 ? "Medium" : "Low"} Confidence
              </Badge>
              <div className="text-3xl md:text-4xl font-bold tabular-nums">
                {team1.projectedScore} - {team2.projectedScore}
              </div>
              <div className="text-xs text-muted-foreground">Projected Score</div>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <span className="text-xs text-muted-foreground">O/U</span>
                <Badge variant="outline" className="text-xs font-mono">
                  {pred.projectedTotal}
                </Badge>
                <span className="text-xs text-muted-foreground ml-2">Spread</span>
                <Badge variant="outline" className="text-xs font-mono">
                  {pred.projectedSpread > 0 ? `${team1.abbr} -${Math.abs(pred.projectedSpread)}` : `${team2.abbr} -${Math.abs(pred.projectedSpread)}`}
                </Badge>
              </div>
            </div>

            {/* Team 2 */}
            <TeamScorePanel
              team={team2}
              isWinner={pred.winner === team2.abbr}
              isHome={pred.homeTeam === team2.abbr}
              alignRight
            />
          </div>

          {/* Win Probability Bar */}
          <div className="mt-6 space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span style={{ color: getTeamColor(team1.abbr) }}>{team1.winProb}%</span>
              <span className="text-xs text-muted-foreground">Win Probability</span>
              <span style={{ color: getTeamColor(team2.abbr) }}>{team2.winProb}%</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden bg-muted flex">
              <div
                className="h-full rounded-l-full transition-all duration-700"
                style={{
                  width: `${team1.winProb}%`,
                  backgroundColor: getTeamColor(team1.abbr),
                }}
              />
              <div
                className="h-full rounded-r-full transition-all duration-700"
                style={{
                  width: `${team2.winProb}%`,
                  backgroundColor: getTeamColor(team2.abbr),
                }}
              />
            </div>
          </div>

          {/* Model Info */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Brain className="w-3 h-3" />
            <span>{pred.modelInfo.type}</span>
            <span className="text-muted-foreground/50">|</span>
            <span>{pred.modelInfo.features} features analyzed</span>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function TeamScorePanel({
  team,
  isWinner,
  isHome,
  alignRight,
}: {
  team: PredictionTeam;
  isWinner: boolean;
  isHome: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={`space-y-1 ${alignRight ? "text-right" : "text-left"}`}>
      <div className={`flex items-center gap-2 ${alignRight ? "justify-end" : ""}`}>
        {isHome && <Home className="w-3.5 h-3.5 text-muted-foreground" />}
        {!isHome && team.winProb > 0 && <Plane className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-2xl md:text-3xl font-bold" style={{ color: getTeamColor(team.abbr) }}>
          {team.abbr}
        </span>
        {isWinner && <Trophy className="w-4 h-4 text-amber-500" />}
      </div>
      <div className="text-sm text-muted-foreground truncate">{team.name}</div>
      <div className="flex items-center gap-2 flex-wrap" style={{ justifyContent: alignRight ? "flex-end" : "flex-start" }}>
        <Badge variant="outline" className="text-xs">{team.record}</Badge>
        <Badge
          variant="outline"
          className={`text-xs ${team.streak.type === "W" ? "border-emerald-500/40 text-emerald-500" : "border-red-500/40 text-red-500"}`}
        >
          {team.streak.type === "W" ? <Flame className="w-3 h-3 mr-1" /> : <Snowflake className="w-3 h-3 mr-1" />}
          {team.streak.type}{team.streak.count}
        </Badge>
        <span className="text-xs text-muted-foreground">L10: {team.last10}</span>
      </div>
    </div>
  );
}

function PredictionBreakdown({ prediction }: { prediction: PredictionResult }) {
  const { team1, team2 } = prediction;

  const radarData = [
    { stat: "Offense", team1: Math.min(100, (team1.offRating / 1.2)), team2: Math.min(100, (team2.offRating / 1.2)) },
    { stat: "Defense", team1: Math.min(100, (200 - team1.defRating) / 1.1), team2: Math.min(100, (200 - team2.defRating) / 1.1) },
    { stat: "Scoring", team1: Math.min(100, team1.ppg / 1.3), team2: Math.min(100, team2.ppg / 1.3) },
    { stat: "Opp Def", team1: Math.min(100, (140 - team1.oppPpg) / 0.5), team2: Math.min(100, (140 - team2.oppPpg) / 0.5) },
    { stat: "Net Rtg", team1: Math.min(100, Math.max(0, (team1.netRating + 15) * 3.3)), team2: Math.min(100, Math.max(0, (team2.netRating + 15) * 3.3)) },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Radar Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Team Comparison Radar</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="stat" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
              <Radar
                name={team1.abbr}
                dataKey="team1"
                stroke={getTeamColor(team1.abbr)}
                fill={getTeamColor(team1.abbr)}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Radar
                name={team2.abbr}
                dataKey="team2"
                stroke={getTeamColor(team2.abbr)}
                fill={getTeamColor(team2.abbr)}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Key Edges */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Key Prediction Drivers</CardTitle>
          <CardDescription>Top factors influencing the prediction</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {prediction.featureImportance.slice(0, 7).map((f, i) => {
            const favorsTeam1 = f.favors === prediction.team1.abbr;
            const color = favorsTeam1 ? getTeamColor(team1.abbr) : getTeamColor(team2.abbr);
            const absContribution = Math.abs(f.contribution);
            const maxContribution = Math.abs(prediction.featureImportance[0].contribution);
            const barWidth = maxContribution > 0 ? (absContribution / maxContribution) * 100 : 0;

            return (
              <div key={f.feature} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{f.feature}</span>
                  <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }}>
                    {f.favors}
                  </Badge>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${barWidth}%`, backgroundColor: color }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{team1.abbr}: {typeof f.team1Value === "number" ? f.team1Value.toFixed(1) : f.team1Value}</span>
                  <span>{team2.abbr}: {typeof f.team2Value === "number" ? f.team2Value.toFixed(1) : f.team2Value}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureImportancePanel({ prediction }: { prediction: PredictionResult }) {
  const { team1, team2, featureImportance } = prediction;

  // Bar chart data for feature contributions
  const chartData = featureImportance.map((f) => ({
    feature: f.feature,
    contribution: Math.round(f.contribution * 1000) / 1000,
    fill: f.favors === team1.abbr ? getTeamColor(team1.abbr) : f.favors === team2.abbr ? getTeamColor(team2.abbr) : "hsl(var(--muted))",
  }));

  return (
    <div className="space-y-4">
      {/* Feature Importance Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Feature Contribution to Prediction
          </CardTitle>
          <CardDescription>
            Positive values favor {team1.abbr}, negative values favor {team2.abbr}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={Math.max(400, featureImportance.length * 32)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 20, top: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="feature" tick={{ fontSize: 12 }} width={95} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => [value.toFixed(4), "Contribution"]}
              />
              <Bar dataKey="contribution" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Feature Details Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Feature Details</CardTitle>
          <CardDescription>All features used in the prediction model</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Feature</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Weight</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: getTeamColor(team1.abbr) }}>{team1.abbr}</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: getTeamColor(team2.abbr) }}>{team2.abbr}</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Favors</th>
                </tr>
              </thead>
              <tbody>
                {featureImportance.map((f) => (
                  <tr key={f.feature} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 font-medium">{f.feature}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{(f.weight * 100).toFixed(0)}%</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {typeof f.team1Value === "number" ? f.team1Value.toFixed(2) : f.team1Value}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {typeof f.team2Value === "number" ? f.team2Value.toFixed(2) : f.team2Value}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          borderColor: f.favors === "neutral" ? undefined : getTeamColor(f.favors),
                          color: f.favors === "neutral" ? undefined : getTeamColor(f.favors),
                        }}
                      >
                        {f.favors}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HeadToHeadStats({ prediction }: { prediction: PredictionResult }) {
  const { team1, team2, comparison } = prediction;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Statistical Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {comparison.stats.map((stat) => {
          const t1Val = parseFloat(stat.team1);
          const t2Val = parseFloat(stat.team2);
          const maxVal = Math.max(t1Val, t2Val);
          const t1Pct = maxVal > 0 ? (t1Val / maxVal) * 100 : 50;
          const t2Pct = maxVal > 0 ? (t2Val / maxVal) * 100 : 50;

          return (
            <div key={stat.label} className="grid grid-cols-[1fr_2fr_auto_2fr_1fr] gap-2 items-center py-2 border-b border-border/30 last:border-0">
              <div className={`text-right text-sm font-semibold tabular-nums ${stat.better === 1 ? "" : "text-muted-foreground"}`}
                   style={stat.better === 1 ? { color: getTeamColor(team1.abbr) } : {}}>
                {stat.team1}
              </div>
              <div className="flex justify-end">
                <div className="h-2.5 rounded-full overflow-hidden bg-muted w-full">
                  <div
                    className="h-full rounded-full transition-all duration-500 ml-auto"
                    style={{
                      width: `${t1Pct}%`,
                      backgroundColor: stat.better === 1 ? getTeamColor(team1.abbr) : "hsl(var(--muted-foreground) / 0.3)",
                    }}
                  />
                </div>
              </div>
              <div className="text-center text-xs font-medium text-muted-foreground min-w-[60px]">
                {stat.label}
              </div>
              <div className="flex justify-start">
                <div className="h-2.5 rounded-full overflow-hidden bg-muted w-full">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${t2Pct}%`,
                      backgroundColor: stat.better === 2 ? getTeamColor(team2.abbr) : "hsl(var(--muted-foreground) / 0.3)",
                    }}
                  />
                </div>
              </div>
              <div className={`text-left text-sm font-semibold tabular-nums ${stat.better === 2 ? "" : "text-muted-foreground"}`}
                   style={stat.better === 2 ? { color: getTeamColor(team2.abbr) } : {}}>
                {stat.team2}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ScoringAnalysis({ prediction }: { prediction: PredictionResult }) {
  const { team1, team2, comparison } = prediction;
  const qs = comparison.quarterScoring;

  const quarterData = [
    { quarter: "Q1", [team1.abbr]: qs.team1.q1, [team2.abbr]: qs.team2.q1 },
    { quarter: "Q2", [team1.abbr]: qs.team1.q2, [team2.abbr]: qs.team2.q2 },
    { quarter: "Q3", [team1.abbr]: qs.team1.q3, [team2.abbr]: qs.team2.q3 },
    { quarter: "Q4", [team1.abbr]: qs.team1.q4, [team2.abbr]: qs.team2.q4 },
  ];

  const halfData = [
    { half: "1st Half", [team1.abbr]: qs.team1.firstHalf, [team2.abbr]: qs.team2.firstHalf },
    { half: "2nd Half", [team1.abbr]: qs.team1.secondHalf, [team2.abbr]: qs.team2.secondHalf },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Avg Scoring by Quarter</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={quarterData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="quarter" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Bar dataKey={team1.abbr} fill={getTeamColor(team1.abbr)} radius={[4, 4, 0, 0]} />
              <Bar dataKey={team2.abbr} fill={getTeamColor(team2.abbr)} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Quarter averages */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {["Q1", "Q2", "Q3", "Q4"].map((q, i) => {
              const t1Val = [qs.team1.q1, qs.team1.q2, qs.team1.q3, qs.team1.q4][i];
              const t2Val = [qs.team2.q1, qs.team2.q2, qs.team2.q3, qs.team2.q4][i];
              return (
                <div key={q} className="text-center p-2 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">{q}</div>
                  <div className="text-sm font-bold" style={{ color: getTeamColor(team1.abbr) }}>
                    {t1Val.toFixed(1)}
                  </div>
                  <div className="text-sm font-bold" style={{ color: getTeamColor(team2.abbr) }}>
                    {t2Val.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Avg Scoring by Half</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={halfData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="half" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Bar dataKey={team1.abbr} fill={getTeamColor(team1.abbr)} radius={[4, 4, 0, 0]} />
              <Bar dataKey={team2.abbr} fill={getTeamColor(team2.abbr)} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Half summary */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            {["1st Half", "2nd Half"].map((half, i) => {
              const t1Val = [qs.team1.firstHalf, qs.team1.secondHalf][i];
              const t2Val = [qs.team2.firstHalf, qs.team2.secondHalf][i];
              return (
                <div key={half} className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2 text-center">{half}</div>
                  <div className="flex justify-around">
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">{prediction.team1.abbr}</div>
                      <div className="text-lg font-bold" style={{ color: getTeamColor(team1.abbr) }}>
                        {t1Val.toFixed(1)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">{prediction.team2.abbr}</div>
                      <div className="text-lg font-bold" style={{ color: getTeamColor(team2.abbr) }}>
                        {t2Val.toFixed(1)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
