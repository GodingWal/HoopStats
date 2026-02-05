import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import {
  Loader2, FlaskConical, TrendingUp, TrendingDown,
  Target, Scale, Activity, CheckCircle2, XCircle,
  ArrowUpRight, ArrowDownRight, Minus, Clock, AlertTriangle,
  RefreshCw,
} from "lucide-react";

// ==================== HELPERS ====================

const safeFixed = (val: number | string | null | undefined, digits: number = 1): string => {
  if (val === null || val === undefined) return "—";
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return "—";
  return num.toFixed(digits);
};

const safePercentage = (val: number | string | null | undefined, digits: number = 0): string => {
  if (val === null || val === undefined) return "—";
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return "—";
  return (num * 100).toFixed(digits) + "%";
};

// ==================== TYPE DEFINITIONS ====================

interface SignalData {
  signalName: string;
  statType: string;
  totalPredictions: number;
  totalCorrect: number;
  accuracy: number;
  overPredictions: number;
  overCorrect: number;
  underPredictions: number;
  underCorrect: number;
  avgError: number;
  lastEvaluated: string;
  grade: "HIGH" | "MEDIUM" | "LOW" | "NOISE";
}

interface WeightData {
  weight: number;
  accuracy: number;
  sampleSize?: number;
  sample_size?: number;
  prior_weight?: number;
}

interface WeightsResponse {
  weights: Record<string, WeightData>;
  isDefault: boolean;
  statType: string;
  overallAccuracy?: number;
  sampleSize?: number;
  calculatedAt?: string;
  validFrom?: string;
}

interface ProjectionLog {
  id: number;
  playerName: string;
  gameDate: string;
  opponent: string;
  statType: string;
  line: number | null;
  projectedValue: number;
  confidenceScore: number;
  predictedDirection: string | null;
  predictedEdge: number | null;
  signals: Record<string, number>;
  baselineValue: number;
  actualValue: number | null;
  projectionHit: boolean | null;
  projectionError: number | null;
}

interface OverviewData {
  totalProjections: number;
  completedProjections: number;
  overallHitRate: number;
  avgConfidence: number;
  avgError: number;
  byStatType: Record<string, {
    total: number;
    completed: number;
    hits: number;
    hitRate: number;
    avgConfidence: number;
    avgError: number;
  }>;
  recentAccuracy: Array<{ date: string; total: number; hits: number; accuracy: number }>;
  message?: string;
  staleness?: {
    pendingActuals: number;
    validationStale: boolean;
    lastValidationDate: string | null;
    needsRefresh: boolean;
  };
}

interface RefreshStatus {
  isRefreshing: boolean;
  lastRefreshTime: string | null;
  lastResult: {
    actuals?: { success: boolean; message: string };
    validation?: { success: boolean; message: string };
    duration?: string;
    error?: string;
  } | null;
}

interface BacktestRun {
  id: number;
  statType: string;
  daysEvaluated: number;
  startDate: string;
  endDate: string;
  totalPredictions: number;
  correctPredictions: number;
  overallAccuracy: number;
  signalBreakdown: Record<string, { n: number; accuracy: number }>;
  runStartedAt: string;
  runCompletedAt: string | null;
}

// ==================== SIGNAL DISPLAY CONFIG ====================

const SIGNAL_DISPLAY: Record<string, { label: string; description: string; color: string }> = {
  injury_alpha: { label: "Injury Alpha", description: "Teammate injury usage boost", color: "hsl(142, 76%, 36%)" },
  b2b: { label: "Back-to-Back", description: "B2B fatigue penalty", color: "hsl(0, 84%, 60%)" },
  pace: { label: "Pace Matchup", description: "Opponent pace adjustment", color: "hsl(217, 91%, 60%)" },
  defense: { label: "Def vs Position", description: "Position-specific defense", color: "hsl(271, 91%, 65%)" },
  blowout: { label: "Blowout Risk", description: "Minutes reduction risk", color: "hsl(25, 95%, 53%)" },
  home_away: { label: "Home/Away", description: "Location split analysis", color: "hsl(47, 96%, 53%)" },
  recent_form: { label: "Recent Form", description: "Hot/cold streak detection", color: "hsl(199, 89%, 48%)" },
  referee_impact: { label: "Referee Impact", description: "Referee foul tendency", color: "hsl(320, 70%, 50%)" },
  clv_tracker: { label: "CLV Tracker", description: "Closing line value tracking", color: "hsl(280, 68%, 55%)" },
  defender_matchup: { label: "Defender Matchup", description: "Primary defender impact", color: "hsl(160, 60%, 45%)" },
  matchup_history: { label: "Matchup History", description: "Head-to-head performance", color: "hsl(35, 90%, 50%)" },
  line_movement: { label: "Line Movement", description: "Sharp money detection", color: "hsl(190, 75%, 45%)" },
  fatigue: { label: "Fatigue", description: "Schedule & travel load", color: "hsl(10, 70%, 55%)" },
  referee: { label: "Referee", description: "Referee tendency adjustment", color: "hsl(340, 65%, 50%)" },
};

const GRADE_COLORS: Record<string, string> = {
  HIGH: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  LOW: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  NOISE: "bg-red-500/15 text-red-400 border-red-500/30",
};

// ==================== MAIN COMPONENT ====================

export default function BacktestPage() {
  const [statType, setStatType] = useState("Points");
  const [autoRefreshTriggered, setAutoRefreshTriggered] = useState(false);
  const queryClient = useQueryClient();

  const { data: overview, isLoading: overviewLoading } = useQuery<OverviewData>({
    queryKey: ["/api/backtest/overview"],
    refetchInterval: 60000, // Check every minute for staleness
  });

  // Refresh status query
  const { data: refreshStatus } = useQuery<RefreshStatus>({
    queryKey: ["/api/backtest/refresh/status"],
    refetchInterval: 5000, // Poll while refreshing
  });

  // Refresh mutation
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backtest/refresh", { method: "POST" });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Refresh failed");
      }
      return res.json();
    },
    onSuccess: () => {
      // Invalidate all backtest queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/backtest"] });
    },
  });

  // Auto-refresh when data is stale (only once per page load)
  useEffect(() => {
    if (
      overview?.staleness?.needsRefresh &&
      !autoRefreshTriggered &&
      !refreshMutation.isPending &&
      !refreshStatus?.isRefreshing
    ) {
      console.log("[Backtest] Auto-refreshing stale data...");
      setAutoRefreshTriggered(true);
      refreshMutation.mutate();
    }
  }, [overview?.staleness?.needsRefresh, autoRefreshTriggered, refreshMutation.isPending, refreshStatus?.isRefreshing]);

  const handleManualRefresh = useCallback(() => {
    setAutoRefreshTriggered(true); // Prevent auto-refresh from triggering again
    refreshMutation.mutate();
  }, [refreshMutation]);

  const { data: signalsData, isLoading: signalsLoading } = useQuery<{ signals: SignalData[] }>({
    queryKey: ["/api/backtest/signals", statType],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/signals?statType=${statType}&days=30`);
      if (!res.ok) throw new Error("Failed to fetch signals");
      return res.json();
    },
  });

  const { data: weightsData } = useQuery<WeightsResponse>({
    queryKey: ["/api/backtest/weights", statType],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/weights?statType=${statType}`);
      if (!res.ok) throw new Error("Failed to fetch weights");
      return res.json();
    },
  });

  const { data: projectionsData, isLoading: projectionsLoading } = useQuery<{ projections: ProjectionLog[] }>({
    queryKey: ["/api/backtest/projections", statType],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/projections?days=14&statType=${statType}&limit=100`);
      if (!res.ok) throw new Error("Failed to fetch projections");
      return res.json();
    },
  });

  const { data: runsData } = useQuery<{ runs: BacktestRun[] }>({
    queryKey: ["/api/backtest/runs"],
  });

  const isRefreshing = refreshMutation.isPending || refreshStatus?.isRefreshing;

  if (overviewLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const signals = signalsData?.signals || [];
  const projections = projectionsData?.projections || [];
  const runs = runsData?.runs || [];
  const hasData = overview && overview.totalProjections > 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-primary/20">
            <FlaskConical className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Backtest Lab</h1>
            <p className="text-muted-foreground">
              Signal accuracy, learned weights, and projection validation
            </p>
          </div>
        </div>

        {/* Refresh Controls */}
        <div className="flex items-center gap-3">
          {/* Staleness Indicator */}
          {overview?.staleness?.needsRefresh && !isRefreshing && (
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {overview.staleness.pendingActuals > 0
                ? `${overview.staleness.pendingActuals} pending actuals`
                : "Validation needed"}
            </Badge>
          )}

          {/* Refresh Status */}
          {isRefreshing && (
            <Badge className="bg-primary/15 text-primary border-primary/30 text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Updating data...
            </Badge>
          )}

          {/* Last Refresh Time */}
          {refreshStatus?.lastRefreshTime && !isRefreshing && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(refreshStatus.lastRefreshTime).toLocaleTimeString()}
            </span>
          )}

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Refresh Error Alert */}
      {refreshMutation.isError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <span className="font-medium">Refresh failed:</span> {refreshMutation.error?.message}
        </div>
      )}

      {/* Stat Type Tabs */}
      <Tabs value={statType} onValueChange={setStatType}>
        <div className="overflow-x-auto pb-2">
          <TabsList className="inline-flex w-auto justify-start">
            {[
              "Points", "Rebounds", "Assists", "3-PT Made",
              "Pts+Rebs+Asts", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
              "Steals", "Blocks", "Turnovers", "Fantasy Score", "Blks+Stls"
            ].map((type) => (
              <TabsTrigger key={type} value={type} className="whitespace-nowrap px-4">
                {type}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value={statType} className="space-y-6 mt-4">
          {/* Overview Stats */}
          <OverviewCards overview={overview} />

          {/* Accuracy Trend */}
          {overview && overview.recentAccuracy.length > 0 && (
            <AccuracyTrendChart data={overview.recentAccuracy} />
          )}

          {/* Signal Accuracy Table */}
          <SignalAccuracySection signals={signals} isLoading={signalsLoading} />

          {/* Weights */}
          <WeightsSection weightsData={weightsData} signals={signals} />

          {/* Projection Log */}
          <ProjectionLogSection projections={projections} isLoading={projectionsLoading} />

          {/* Backtest Run History */}
          {runs.length > 0 && <BacktestRunsSection runs={runs} />}

          {/* Empty state */}
          {!hasData && !overviewLoading && (
            <Card>
              <CardContent className="p-12 text-center">
                <FlaskConical className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="text-xl font-semibold mb-2">No Backtest Data Yet</h3>
                <p className="text-muted-foreground max-w-md mx-auto mb-4">
                  The backtest infrastructure is set up and ready. Data will automatically
                  update when projections are captured and games complete.
                </p>
                <Button
                  variant="outline"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                  {isRefreshing ? "Checking for data..." : "Check for Updates"}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ==================== SUB-COMPONENTS ====================

function OverviewCards({ overview }: { overview?: OverviewData }) {
  if (!overview) return null;

  const cards = [
    {
      label: "Total Projections",
      value: overview.totalProjections.toString(),
      icon: Target,
      highlight: false,
    },
    {
      label: "Validated",
      value: overview.completedProjections.toString(),
      icon: CheckCircle2,
      highlight: false,
    },
    {
      label: "Hit Rate",
      value: overview.completedProjections > 0
        ? safePercentage(overview.overallHitRate, 1)
        : "—",
      icon: Activity,
      highlight: overview.overallHitRate > 0.524,
    },
    {
      label: "Avg Confidence",
      value: overview.avgConfidence > 0
        ? safePercentage(overview.avgConfidence, 0)
        : "—",
      icon: Scale,
      highlight: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, highlight }) => (
        <div
          key={label}
          className={`p-4 rounded-lg border ${highlight ? "border-primary bg-primary/5" : "border-border"
            }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
          <p className={`text-2xl font-bold ${highlight ? "text-primary" : ""}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function AccuracyTrendChart({ data }: { data: Array<{ date: string; accuracy: number; total: number }> }) {
  const chartData = data.map(d => ({
    date: d.date,
    accuracy: d.accuracy * 100,
    total: d.total,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Daily Accuracy Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              domain={[30, 80]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelFormatter={(v) => new Date(v).toLocaleDateString()}
              formatter={(value: number, name: string) => {
                if (name === "accuracy") return [`${value.toFixed(1)}%`, "Accuracy"];
                return [value, name];
              }}
            />
            {/* 52.4% break-even line */}
            <Line
              type="monotone"
              dataKey={() => 52.4}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={1}
              dot={false}
              name="break-even"
            />
            <Line
              type="monotone"
              dataKey="accuracy"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(var(--primary))" }}
              name="accuracy"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function SignalAccuracySection({ signals, isLoading }: { signals: SignalData[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // If no signals from API, show all signals with default state
  const displaySignals = signals.length > 0 ? signals : Object.keys(SIGNAL_DISPLAY).map(name => ({
    signalName: name,
    statType: "Points",
    totalPredictions: 0,
    totalCorrect: 0,
    accuracy: 0,
    overPredictions: 0,
    overCorrect: 0,
    underPredictions: 0,
    underCorrect: 0,
    avgError: 0,
    lastEvaluated: "",
    grade: "NOISE" as const,
  }));

  // Data for bar chart
  const chartData = displaySignals.map(s => ({
    name: SIGNAL_DISPLAY[s.signalName]?.label || s.signalName,
    accuracy: s.accuracy * 100,
    fill: SIGNAL_DISPLAY[s.signalName]?.color || "hsl(var(--primary))",
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Signal Accuracy Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Signal Accuracy Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-1 text-muted-foreground font-medium">Signal</th>
                  <th className="text-center py-2 px-1 text-muted-foreground font-medium">N</th>
                  <th className="text-center py-2 px-1 text-muted-foreground font-medium">Acc%</th>
                  <th className="text-center py-2 px-1 text-muted-foreground font-medium">Over</th>
                  <th className="text-center py-2 px-1 text-muted-foreground font-medium">Under</th>
                  <th className="text-center py-2 px-1 text-muted-foreground font-medium">Grade</th>
                </tr>
              </thead>
              <tbody>
                {displaySignals.map((signal) => {
                  const display = SIGNAL_DISPLAY[signal.signalName];
                  const overStr = signal.overPredictions > 0
                    ? `${signal.overCorrect}/${signal.overPredictions}`
                    : "—";
                  const underStr = signal.underPredictions > 0
                    ? `${signal.underCorrect}/${signal.underPredictions}`
                    : "—";

                  return (
                    <tr key={signal.signalName} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2.5 px-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: display?.color || "hsl(var(--primary))" }}
                          />
                          <div>
                            <span className="font-medium text-sm">
                              {display?.label || signal.signalName}
                            </span>
                            <p className="text-[10px] text-muted-foreground leading-tight">
                              {display?.description}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="text-center py-2.5 px-1 font-mono text-xs">
                        {signal.totalPredictions || "—"}
                      </td>
                      <td className="text-center py-2.5 px-1 font-mono font-bold text-sm">
                        {signal.totalPredictions > 0 ? safePercentage(signal.accuracy, 1) : "—"}
                      </td>
                      <td className="text-center py-2.5 px-1 font-mono text-xs">{overStr}</td>
                      <td className="text-center py-2.5 px-1 font-mono text-xs">{underStr}</td>
                      <td className="text-center py-2.5 px-1">
                        {signal.totalPredictions > 0 ? (
                          <Badge className={`text-[10px] ${GRADE_COLORS[signal.grade]}`}>
                            {signal.grade}
                          </Badge>
                        ) : (
                          <Badge className="text-[10px] bg-muted/50 text-muted-foreground border-muted">
                            N/A
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Signal Accuracy Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Accuracy by Signal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Accuracy"]}
              />
              {/* 52.4% break-even reference */}
              <Bar dataKey="accuracy" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground justify-center">
            <div className="w-8 border-t border-dashed border-muted-foreground" />
            52.4% = break-even line
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WeightsSection({ weightsData, signals }: { weightsData?: WeightsResponse; signals: SignalData[] }) {
  if (!weightsData?.weights) return null;

  const weights = weightsData.weights;

  // Build radar chart data
  const radarData = Object.entries(weights).map(([name, data]) => {
    const display = SIGNAL_DISPLAY[name];
    return {
      signal: display?.label || name,
      weight: (data.weight || 0) * 100,
      accuracy: (data.accuracy || 0) * 100,
    };
  });

  // Sort weights by value
  const sortedWeights = Object.entries(weights)
    .map(([name, data]) => ({
      name,
      label: SIGNAL_DISPLAY[name]?.label || name,
      color: SIGNAL_DISPLAY[name]?.color || "hsl(var(--primary))",
      weight: data.weight || 0,
      accuracy: data.accuracy || 0,
      sampleSize: data.sampleSize || data.sample_size || 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Weights Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            Signal Weights
            {weightsData.isDefault && (
              <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30 ml-2">
                Default
              </Badge>
            )}
          </CardTitle>
          {weightsData.calculatedAt && (
            <p className="text-xs text-muted-foreground">
              Last updated: {new Date(weightsData.calculatedAt).toLocaleDateString()}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedWeights.map(({ name, label, color, weight, accuracy, sampleSize }) => (
              <div key={name} className="flex items-center gap-3">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium truncate">{label}</span>
                    <span className="text-sm font-mono font-bold">
                      {safePercentage(weight, 0)}
                    </span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(weight * 100 * 3, 100)}%`,
                        backgroundColor: color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  {sampleSize > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {safePercentage(accuracy, 1)} accuracy ({sampleSize} samples)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Radar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Weight vs Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis
                dataKey="signal"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <PolarRadiusAxis
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                domain={[0, 100]}
              />
              <Radar
                name="Weight"
                dataKey="weight"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Radar
                name="Accuracy"
                dataKey="accuracy"
                stroke="hsl(142, 76%, 36%)"
                fill="hsl(142, 76%, 36%)"
                fillOpacity={0.1}
                strokeWidth={2}
                strokeDasharray="3 3"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(1)}%`,
                  name,
                ]}
              />
            </RadarChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 mt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-primary rounded" />
              Weight
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "hsl(142, 76%, 36%)" }} />
              Accuracy
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectionLogSection({ projections, isLoading }: { projections: ProjectionLog[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (projections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Recent Projections
          </div>
          <Badge className="bg-muted/50 text-muted-foreground border-muted text-xs">
            {projections.length} records
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 text-muted-foreground font-medium">Player</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Date</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Line</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Projected</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Dir</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Conf</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Actual</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {projections.slice(0, 30).map((proj) => {
                const hasActual = proj.actualValue !== null;
                const edge = proj.predictedEdge;

                return (
                  <tr key={proj.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-2">
                      <div>
                        <span className="font-medium">{proj.playerName}</span>
                        {proj.opponent && (
                          <span className="text-xs text-muted-foreground ml-1">
                            vs {proj.opponent}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-center py-2 text-xs text-muted-foreground">
                      {new Date(proj.gameDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="text-center py-2 font-mono">
                      {safeFixed(proj.line)}
                    </td>
                    <td className="text-center py-2 font-mono font-bold">
                      {safeFixed(proj.projectedValue)}
                    </td>
                    <td className="text-center py-2">
                      {proj.predictedDirection === "OVER" ? (
                        <ArrowUpRight className="w-4 h-4 text-emerald-400 inline" />
                      ) : proj.predictedDirection === "UNDER" ? (
                        <ArrowDownRight className="w-4 h-4 text-rose-400 inline" />
                      ) : (
                        <Minus className="w-4 h-4 text-muted-foreground inline" />
                      )}
                    </td>
                    <td className="text-center py-2">
                      <span
                        className={`text-xs font-mono ${proj.confidenceScore >= 0.7
                          ? "text-emerald-400"
                          : proj.confidenceScore >= 0.5
                            ? "text-yellow-400"
                            : "text-muted-foreground"
                          }`}
                      >
                        {safePercentage(proj.confidenceScore, 0)}
                      </span>
                    </td>
                    <td className="text-center py-2 font-mono">
                      {hasActual ? safeFixed(proj.actualValue) : "—"}
                    </td>
                    <td className="text-center py-2">
                      {hasActual ? (
                        proj.projectionHit ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 inline" />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function BacktestRunsSection({ runs }: { runs: BacktestRun[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          Backtest Run History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 text-muted-foreground font-medium">Stat</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Period</th>
                <th className="text-center py-2 text-muted-foreground font-medium">N</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Accuracy</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Run Date</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-2 font-medium">{run.statType}</td>
                  <td className="text-center py-2 text-xs text-muted-foreground">
                    {run.daysEvaluated}d
                  </td>
                  <td className="text-center py-2 font-mono">{run.totalPredictions}</td>
                  <td className="text-center py-2 font-mono font-bold">
                    <span className={run.overallAccuracy > 0.524 ? "text-emerald-400" : ""}>
                      {safePercentage(run.overallAccuracy, 1)}
                    </span>
                  </td>
                  <td className="text-center py-2 text-xs text-muted-foreground">
                    {new Date(run.runStartedAt).toLocaleDateString()}
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
