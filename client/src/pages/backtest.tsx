import React, { useState, useEffect, useCallback } from "react";
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
  RefreshCw, BrainCircuit, Database, Layers,
} from "lucide-react";

// ==================== HELPERS ====================

const safeFixed = (val: number | string | null | undefined, digits: number = 1): string => {
  if (val === null || val === undefined) return "—";
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return "—";
  return Number(num).toFixed(digits);
};

const safePercentage = (val: number | string | null | undefined, digits: number = 0): string => {
  if (val === null || val === undefined) return "—";
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return "—";
  return Number(num * 100).toFixed(digits) + "%";
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

// ==================== XGBOOST TYPES ====================

interface XGBoostOverview {
  total: number;
  labeled: number;
  unlabeled: number;
  hitRate: number | null;
  avgEdgeTotal: number;
  avgSignalScore: number;
  byStatType: Record<string, {
    total: number;
    labeled: number;
    hits: number;
    hitRate: number | null;
    avgEdge: number;
  }>;
  dailyAccuracy: Array<{ date: string; total: number; hits: number; accuracy: number }>;
  byConfidenceTier: Array<{
    tier: string;
    total: number;
    labeled: number;
    hits: number;
    hitRate: number | null;
  }>;
  message?: string;
}

interface ShapDriver {
  feature: string;
  shap_value: number;
  feature_value: number;
  direction: string;
}

interface XGBoostPrediction {
  id: number;
  playerId: string;
  gameDate: string;
  statType: string;
  lineValue: number;
  signalScore: number;
  edgeTotal: number;
  predictedDirection: string | null;
  confidenceTier: string | null;
  actualValue: number | null;
  actualMinutes: number | null;
  hit: boolean | null;
  closingLine: number | null;
  closingLineValue: number | null;
  capturedAt: string;
  settledAt: string | null;
  modelProb: number | null;
  calibrationMethod: string | null;
  shapTopDrivers: ShapDriver[] | null;
}

interface XGBoostFeature {
  name: string;
  importance: number;
  hitMean: number;
  missMean: number;
  diff: number;
}

// ==================== EVALUATION METRICS TYPES ====================

interface CalibrationBin {
  binRange: string;
  predicted: number;
  actual: number;
  count: number;
}

interface EvalMetrics {
  brierScore: number;
  logLoss: number;
  ece: number;
  avgClv: number;
  clvPositiveRate: number;
  hitRate: number;
  calibrationBins: CalibrationBin[];
  statBreakdown: Record<string, {
    count: number;
    hitRate: number;
    brierScore: number;
    roi: number;
  }>;
}

interface EvalMetricsResponse {
  metrics: EvalMetrics | null;
  sampleSize: number;
  clvSampleSize: number;
  days: number;
  message?: string;
}

interface MarketDisagreementItem {
  playerName: string;
  statType: string;
  gameDate: string;
  modelProjection: number;
  marketConsensus: number;
  line: number;
  difference: number;
  differencePct: number;
  modelSide: string;
  marketSide: string;
  sidesAgree: boolean;
  numBooks: number;
  lineSpread: number;
  actualValue: number | null;
  modelCorrect: boolean | null;
  marketCorrect: boolean | null;
  inefficiencyScore: number;
}

interface MarketComparisonData {
  totalCompared: number;
  totalDisagreements: number;
  agreementRate: number;
  modelCloserToActualRate: number | null;
  totalWithActuals: number;
  topDisagreements: MarketDisagreementItem[];
}

interface MarketComparisonResponse {
  comparison: MarketComparisonData | null;
  days: number;
}

// ==================== CONFIDENCE TIER COLORS ====================

const TIER_COLORS: Record<string, string> = {
  HIGH: "text-emerald-400",
  MEDIUM: "text-yellow-400",
  LOW: "text-orange-400",
  VERY_LOW: "text-red-400",
};

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
  rest_days: { label: "Rest Days", description: "Days of rest advantage/disadvantage", color: "hsl(170, 65%, 45%)" },
  minutes_projection: { label: "Minutes Projection", description: "Expected minutes impact", color: "hsl(55, 75%, 50%)" },
};

// Maps legacy/alternate signal names (from SignalEngine) to canonical registry names.
// When both the legacy and canonical name exist in the DB, data is merged under the canonical name.
const SIGNAL_NAME_ALIASES: Record<string, string> = {
  usage_redistribution: "injury_alpha",
  positional_defense: "defense",
  b2b_fatigue: "b2b",
  pace_matchup: "pace",
  ref_foul: "referee",
  blowout_risk: "blowout",
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
      // Must use predicate for string-prefix matching since query keys are
      // full paths like ["/api/backtest/overview"], not nested arrays like ["/api/backtest", "overview"]
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === 'string' &&
          query.queryKey[0].startsWith('/api/backtest'),
      });
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

  // XGBoost queries
  const { data: xgbOverview } = useQuery<XGBoostOverview>({
    queryKey: ["/api/backtest/xgboost-overview"],
    queryFn: async () => {
      const res = await fetch("/api/backtest/xgboost-overview");
      if (!res.ok) throw new Error("Failed to fetch XGBoost overview");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: xgbPredictions, isLoading: xgbPredictionsLoading } = useQuery<{ predictions: XGBoostPrediction[] }>({
    queryKey: ["/api/backtest/xgboost-predictions", statType],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/xgboost-predictions?statType=${statType}&days=14&limit=100`);
      if (!res.ok) throw new Error("Failed to fetch XGBoost predictions");
      return res.json();
    },
  });

  const { data: xgbFeatures } = useQuery<{ features: XGBoostFeature[]; sampleSize: number }>({
    queryKey: ["/api/backtest/xgboost-features", statType],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/xgboost-features?statType=${statType}`);
      if (!res.ok) throw new Error("Failed to fetch XGBoost features");
      return res.json();
    },
  });

  // Evaluation metrics (Brier, ECE, log-loss, CLV)
  const { data: evalMetrics } = useQuery<EvalMetricsResponse>({
    queryKey: ["/api/backtest/evaluation-metrics", statType],
    queryFn: async () => {
      const url = statType
        ? `/api/backtest/evaluation-metrics?days=30&statType=${statType}`
        : `/api/backtest/evaluation-metrics?days=30`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch evaluation metrics");
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Market comparison
  const { data: marketComparison } = useQuery<MarketComparisonResponse>({
    queryKey: ["/api/backtest/market-comparison"],
    queryFn: async () => {
      const res = await fetch("/api/backtest/market-comparison?days=7");
      if (!res.ok) throw new Error("Failed to fetch market comparison");
      return res.json();
    },
    refetchInterval: 60000,
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

          {/* Evaluation Metrics (Brier, ECE, Log-Loss, CLV) */}
          {evalMetrics?.metrics && (
            <EvaluationMetricsSection metrics={evalMetrics.metrics} sampleSize={evalMetrics.sampleSize} clvSampleSize={evalMetrics.clvSampleSize} />
          )}

          {/* Market Comparison */}
          {marketComparison?.comparison && marketComparison.comparison.totalCompared > 0 && (
            <MarketComparisonSection comparison={marketComparison.comparison} />
          )}

          {hasData ? (
            <>
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

              {/* XGBoost Model Section */}
              {xgbOverview && xgbOverview.total > 0 && (
                <>
                  <XGBoostOverviewCards overview={xgbOverview} />

                  {xgbOverview.dailyAccuracy.length > 0 && (
                    <XGBoostAccuracyChart data={xgbOverview.dailyAccuracy} />
                  )}

                  {xgbOverview.byConfidenceTier.length > 0 && (
                    <XGBoostConfidenceTierSection tiers={xgbOverview.byConfidenceTier} />
                  )}

                  {xgbFeatures && xgbFeatures.features.length > 0 && (
                    <XGBoostFeatureImportanceSection features={xgbFeatures.features} sampleSize={xgbFeatures.sampleSize} />
                  )}

                  <XGBoostPredictionLogSection
                    predictions={xgbPredictions?.predictions || []}
                    isLoading={xgbPredictionsLoading}
                  />
                </>
              )}
            </>
          ) : (
            /* Empty state - only show when there's no data */
            !overviewLoading && (
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
            )
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
                if (name === "accuracy") return [`${Number(value).toFixed(1)}%`, "Accuracy"];
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

  // Merge API signals with SIGNAL_DISPLAY to always show all known signals.
  // Also normalizes legacy/alternate signal names to canonical names.
  const displaySignals = (() => {
    const defaultSignal = (name: string): SignalData => ({
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
    });

    // Build a map of canonical signal name -> merged data
    const signalMap = new Map<string, SignalData>();

    // Seed with all SIGNAL_DISPLAY entries (defaults)
    for (const name of Object.keys(SIGNAL_DISPLAY)) {
      signalMap.set(name, defaultSignal(name));
    }

    // Overlay API data, resolving aliases
    for (const signal of signals) {
      const canonicalName = SIGNAL_NAME_ALIASES[signal.signalName] || signal.signalName;
      const existing = signalMap.get(canonicalName);

      if (existing) {
        // Merge: add predictions from aliased names together
        signalMap.set(canonicalName, {
          ...signal,
          signalName: canonicalName,
          totalPredictions: existing.totalPredictions + signal.totalPredictions,
          totalCorrect: existing.totalCorrect + signal.totalCorrect,
          overPredictions: existing.overPredictions + signal.overPredictions,
          overCorrect: existing.overCorrect + signal.overCorrect,
          underPredictions: existing.underPredictions + signal.underPredictions,
          underCorrect: existing.underCorrect + signal.underCorrect,
          accuracy: (existing.totalPredictions + signal.totalPredictions) > 0
            ? (existing.totalCorrect + signal.totalCorrect) / (existing.totalPredictions + signal.totalPredictions)
            : 0,
          grade: signal.totalPredictions > 0 ? signal.grade : existing.grade,
        });
      } else if (canonicalName in SIGNAL_DISPLAY || !(signal.signalName in SIGNAL_NAME_ALIASES)) {
        // New signal not in SIGNAL_DISPLAY and not an alias — show it
        signalMap.set(canonicalName, { ...signal, signalName: canonicalName });
      }
    }

    return Array.from(signalMap.values());
  })();

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
                formatter={(value: number) => [`${Number(value).toFixed(1)}%`, "Accuracy"]}
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
                  `${Number(value).toFixed(1)}%`,
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

// ==================== XGBOOST SUB-COMPONENTS ====================

function XGBoostOverviewCards({ overview }: { overview: XGBoostOverview }) {
  const cards = [
    {
      label: "XGBoost Training Samples",
      value: overview.total.toLocaleString(),
      icon: Database,
      sub: `${overview.labeled} labeled / ${overview.unlabeled} pending`,
      highlight: false,
    },
    {
      label: "XGBoost Hit Rate",
      value: overview.hitRate !== null ? safePercentage(overview.hitRate, 1) : "—",
      icon: BrainCircuit,
      sub: overview.labeled > 0 ? `from ${overview.labeled} settled picks` : "No settled picks yet",
      highlight: overview.hitRate !== null && overview.hitRate > 0.524,
    },
    {
      label: "Avg Edge Total",
      value: safeFixed(overview.avgEdgeTotal, 1),
      icon: Layers,
      sub: "Mean edge score across all predictions",
      highlight: false,
    },
    {
      label: "Stat Types Tracked",
      value: Object.keys(overview.byStatType).length.toString(),
      icon: Activity,
      sub: Object.keys(overview.byStatType).slice(0, 3).join(", ") + (Object.keys(overview.byStatType).length > 3 ? "..." : ""),
      highlight: false,
    },
  ];

  return (
    <>
      {/* Section Header */}
      <div className="flex items-center gap-2 pt-4">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-500/20">
          <BrainCircuit className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">XGBoost Model Training</h2>
          <p className="text-xs text-muted-foreground">
            ML feature pipeline — 46-feature vectors logged at bet generation, outcomes filled at settlement
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, sub, highlight }) => (
          <div
            key={label}
            className={`p-4 rounded-lg border ${highlight ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${highlight ? "text-emerald-400" : ""}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* By Stat Type Breakdown */}
      {Object.keys(overview.byStatType).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-orange-400" />
              XGBoost Hit Rate by Stat Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 px-2 text-muted-foreground font-medium">Stat Type</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Total</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Labeled</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Hits</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Hit Rate</th>
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Avg Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(overview.byStatType)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([st, data]) => (
                      <tr key={st} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2 px-2 font-medium">{st}</td>
                        <td className="text-center py-2 px-2 font-mono text-xs">{data.total}</td>
                        <td className="text-center py-2 px-2 font-mono text-xs">{data.labeled}</td>
                        <td className="text-center py-2 px-2 font-mono text-xs">{data.hits}</td>
                        <td className="text-center py-2 px-2 font-mono font-bold">
                          <span className={data.hitRate !== null && data.hitRate > 0.524 ? "text-emerald-400" : ""}>
                            {data.hitRate !== null ? safePercentage(data.hitRate, 1) : "—"}
                          </span>
                        </td>
                        <td className="text-center py-2 px-2 font-mono text-xs">
                          {safeFixed(data.avgEdge, 1)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function XGBoostAccuracyChart({ data }: { data: Array<{ date: string; accuracy: number; total: number }> }) {
  const chartData = data.map(d => ({
    date: d.date,
    accuracy: d.accuracy * 100,
    total: d.total,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-orange-400" />
          XGBoost Daily Accuracy
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
                if (name === "accuracy") return [`${Number(value).toFixed(1)}%`, "XGBoost Accuracy"];
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
              stroke="hsl(25, 95%, 53%)"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(25, 95%, 53%)" }}
              name="accuracy"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function XGBoostConfidenceTierSection({ tiers }: { tiers: XGBoostOverview["byConfidenceTier"] }) {
  const chartData = tiers
    .filter(t => t.labeled > 0)
    .map(t => ({
      tier: t.tier,
      hitRate: t.hitRate !== null ? t.hitRate * 100 : 0,
      total: t.total,
      labeled: t.labeled,
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-orange-400" />
            Hit Rate by Confidence Tier
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {tiers.map(t => (
              <div key={t.tier} className="flex items-center gap-3">
                <Badge className={`text-xs min-w-[80px] justify-center ${
                  GRADE_COLORS[t.tier] || "bg-muted/50 text-muted-foreground border-muted"
                }`}>
                  {t.tier}
                </Badge>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{t.total} predictions ({t.labeled} settled)</span>
                    <span className={`font-mono font-bold ${
                      t.hitRate !== null && t.hitRate > 0.524 ? "text-emerald-400" : ""
                    }`}>
                      {t.hitRate !== null ? safePercentage(t.hitRate, 1) : "—"}
                    </span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-orange-400/70"
                      style={{ width: `${t.hitRate !== null ? Math.min(t.hitRate * 100 * 1.5, 100) : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-orange-400" />
              Accuracy by Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="tier"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "hitRate") return [`${Number(value).toFixed(1)}%`, "Hit Rate"];
                    return [value, name];
                  }}
                />
                <Bar dataKey="hitRate" fill="hsl(25, 95%, 53%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground justify-center">
              <div className="w-8 border-t border-dashed border-muted-foreground" />
              52.4% = break-even line
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function XGBoostFeatureImportanceSection({ features, sampleSize }: { features: XGBoostFeature[]; sampleSize: number }) {
  const top12 = features.slice(0, 12);

  const FEATURE_LABELS: Record<string, string> = {
    edge_star_out: "Star Out Edge",
    edge_b2b: "B2B Edge",
    edge_blowout: "Blowout Edge",
    edge_pace: "Pace Edge",
    edge_bad_defense: "Bad Defense Edge",
    edge_minutes_stability: "Minutes Stability",
    edge_recent_form: "Recent Form Edge",
    edge_home_road: "Home/Road Edge",
    edge_line_movement: "Line Movement Edge",
    total_edges_fired: "Edges Fired",
    line_vs_avg_l10: "Line vs L10 Avg",
    line_vs_avg_l5: "Line vs L5 Avg",
    line_vs_season_avg: "Line vs Season Avg",
    team_pace_actual: "Team Pace",
    opp_pace_actual: "Opp Pace",
    pace_differential: "Pace Diff",
    opp_def_rating: "Opp Def Rating",
    minutes_avg_l10: "Min Avg L10",
    minutes_avg_l5: "Min Avg L5",
    minutes_stdev_l10: "Min StdDev L10",
    home_away_diff: "H/A Diff",
    is_home: "Is Home",
    days_rest: "Days Rest",
    is_b2b: "Is B2B",
    usage_rate_season: "Usage Rate",
    hist_hit_rate: "Hist Hit Rate",
    stdev_last_10: "StdDev L10",
    coeff_of_variation: "Coeff Var",
    pct_games_over_line: "% Games Over Line",
    iqr_last_10: "IQR L10",
    signal_score: "Signal Score",
    projected_value: "Projected Value",
    projected_minutes: "Projected Min",
  };

  const chartData = top12.map(f => ({
    name: FEATURE_LABELS[f.name] || f.name.replace(/_/g, " "),
    importance: parseFloat(Number(f.importance).toFixed(3)),
    positive: f.diff > 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-orange-400" />
            Feature Importance (Top 12)
          </div>
          <Badge className="bg-muted/50 text-muted-foreground border-muted text-xs">
            {sampleSize} samples analyzed
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              width={130}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              formatter={(value: number) => [Number(value).toFixed(3), "Importance"]}
            />
            <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.positive ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"}
                  opacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex justify-center gap-6 mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 76%, 36%)", opacity: 0.8 }} />
            Higher in hits
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(0, 84%, 60%)", opacity: 0.8 }} />
            Higher in misses
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ShapDriversBar({ drivers }: { drivers: ShapDriver[] }) {
  if (!drivers || drivers.length === 0) return null;
  const maxAbs = Math.max(...drivers.map(d => Math.abs(d.shap_value)), 0.01);

  return (
    <div className="space-y-1 py-1">
      {drivers.slice(0, 5).map((d, i) => {
        const pct = Math.abs(d.shap_value) / maxAbs * 100;
        const isOver = d.shap_value > 0;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-36 text-right text-muted-foreground truncate" title={d.feature}>
              {d.feature.replace(/_/g, " ")}
            </span>
            <div className="flex-1 flex items-center gap-1">
              <div
                className={`h-3 rounded-sm ${isOver ? "bg-emerald-500/70" : "bg-rose-500/70"}`}
                style={{ width: `${Math.max(pct, 4)}%` }}
              />
              <span className={`text-[10px] font-mono ${isOver ? "text-emerald-400" : "text-rose-400"}`}>
                {d.shap_value > 0 ? "+" : ""}{Number(d.shap_value).toFixed(3)}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono w-10 text-right">
              {Number(d.feature_value).toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function XGBoostPredictionLogSection({ predictions, isLoading }: { predictions: XGBoostPrediction[]; isLoading: boolean }) {
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (predictions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-400" />
            XGBoost Prediction Log
          </div>
          <Badge className="bg-muted/50 text-muted-foreground border-muted text-xs">
            {predictions.length} records
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
                <th className="text-center py-2 text-muted-foreground font-medium">Stat</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Line</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Dir</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Prob</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Tier</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Edge</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Actual</th>
                <th className="text-center py-2 text-muted-foreground font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {predictions.slice(0, 40).map((pred) => {
                const hasActual = pred.actualValue !== null;
                const hasShap = pred.shapTopDrivers && pred.shapTopDrivers.length > 0;
                const isExpanded = expandedId === pred.id;

                return (
                  <React.Fragment key={pred.id}>
                    <tr
                      className={`border-b border-border/30 hover:bg-muted/30 ${hasShap ? "cursor-pointer" : ""}`}
                      onClick={() => hasShap && setExpandedId(isExpanded ? null : pred.id)}
                    >
                      <td className="py-2">
                        <span className="font-medium text-sm">{pred.playerId}</span>
                      </td>
                      <td className="text-center py-2 text-xs text-muted-foreground">
                        {new Date(pred.gameDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="text-center py-2 text-xs">{pred.statType}</td>
                      <td className="text-center py-2 font-mono">{safeFixed(pred.lineValue)}</td>
                      <td className="text-center py-2">
                        {pred.predictedDirection === "OVER" || pred.predictedDirection === "Over" ? (
                          <ArrowUpRight className="w-4 h-4 text-emerald-400 inline" />
                        ) : pred.predictedDirection === "UNDER" || pred.predictedDirection === "Under" ? (
                          <ArrowDownRight className="w-4 h-4 text-rose-400 inline" />
                        ) : (
                          <Minus className="w-4 h-4 text-muted-foreground inline" />
                        )}
                      </td>
                      <td className="text-center py-2">
                        {pred.modelProb != null ? (
                          <span className="font-mono text-xs">
                            {Number((pred.modelProb * 100).toFixed(0))}%
                            {pred.calibrationMethod === "isotonic" && (
                              <span className="ml-1 text-[9px] text-blue-400" title="Isotonic calibration applied">CAL</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-center py-2">
                        {pred.confidenceTier ? (
                          <Badge className={`text-[10px] ${GRADE_COLORS[pred.confidenceTier] || "bg-muted/50 text-muted-foreground border-muted"}`}>
                            {pred.confidenceTier}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-center py-2 font-mono text-xs">
                        {safeFixed(pred.edgeTotal, 1)}
                      </td>
                      <td className="text-center py-2 font-mono">
                        {hasActual ? safeFixed(pred.actualValue) : "—"}
                      </td>
                      <td className="text-center py-2">
                        {hasActual ? (
                          pred.hit ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-400 inline" />
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasShap && (
                      <tr className="bg-muted/20">
                        <td colSpan={10} className="px-4 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-muted-foreground">SHAP Drivers</span>
                            <span className="text-[10px] text-muted-foreground">(what drove this prediction)</span>
                          </div>
                          <ShapDriversBar drivers={pred.shapTopDrivers!} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}


// ==================== EVALUATION METRICS SECTION ====================

function EvaluationMetricsSection({
  metrics,
  sampleSize,
  clvSampleSize,
}: {
  metrics: EvalMetrics;
  sampleSize: number;
  clvSampleSize: number;
}) {
  const brierQuality = metrics.brierScore < 0.15 ? "Excellent" :
    metrics.brierScore < 0.20 ? "Good" :
    metrics.brierScore < 0.25 ? "Average" : "Poor";
  const brierColor = metrics.brierScore < 0.15 ? "text-emerald-400" :
    metrics.brierScore < 0.20 ? "text-yellow-400" :
    metrics.brierScore < 0.25 ? "text-orange-400" : "text-rose-400";

  const eceQuality = metrics.ece < 0.03 ? "Well Calibrated" :
    metrics.ece < 0.06 ? "Decent" :
    metrics.ece < 0.10 ? "Needs Work" : "Poorly Calibrated";
  const eceColor = metrics.ece < 0.03 ? "text-emerald-400" :
    metrics.ece < 0.06 ? "text-yellow-400" :
    metrics.ece < 0.10 ? "text-orange-400" : "text-rose-400";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">Probabilistic Evaluation Metrics</CardTitle>
          <Badge variant="outline" className="text-xs ml-auto">
            {sampleSize} predictions
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">Brier Score</div>
            <div className={`text-2xl font-bold font-mono ${brierColor}`}>
              {Number(metrics.brierScore).toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{brierQuality}</div>
          </div>

          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">ECE</div>
            <div className={`text-2xl font-bold font-mono ${eceColor}`}>
              {Number(metrics.ece).toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{eceQuality}</div>
          </div>

          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">Log Loss</div>
            <div className="text-2xl font-bold font-mono text-blue-400">
              {Number(metrics.logLoss).toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Lower is better</div>
          </div>

          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">Avg CLV</div>
            <div className={`text-2xl font-bold font-mono ${metrics.avgClv > 0 ? "text-emerald-400" : metrics.avgClv < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
              {metrics.avgClv > 0 ? "+" : ""}{Number(metrics.avgClv).toFixed(3)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{clvSampleSize} w/ closing</div>
          </div>

          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">CLV+ Rate</div>
            <div className={`text-2xl font-bold font-mono ${metrics.clvPositiveRate > 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
              {Number(metrics.clvPositiveRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">Beat closing line</div>
          </div>
        </div>

        {/* Calibration Chart */}
        {metrics.calibrationBins.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Calibration Chart (Predicted vs Actual Hit Rate)</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.calibrationBins.filter(b => b.count > 0)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="binRange" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(value: number, name: string) => [Number(value * 100).toFixed(1) + "%", name === "predicted" ? "Predicted" : "Actual"]}
                  />
                  <Bar dataKey="predicted" fill="hsl(217, 91%, 60%)" name="predicted" opacity={0.6} />
                  <Bar dataKey="actual" fill="hsl(142, 76%, 36%)" name="actual" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Perfect calibration: blue and green bars match. Gaps indicate over/under-confidence.
            </p>
          </div>
        )}

        {/* Per-Stat Brier Score Breakdown */}
        {Object.keys(metrics.statBreakdown).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Per-Stat Breakdown</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="text-left py-2 px-2">Stat</th>
                    <th className="text-center py-2 px-2">Count</th>
                    <th className="text-center py-2 px-2">Hit Rate</th>
                    <th className="text-center py-2 px-2">Brier</th>
                    <th className="text-center py-2 px-2">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metrics.statBreakdown)
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([stat, data]) => (
                    <tr key={stat} className="border-b border-border/20">
                      <td className="py-2 px-2 font-medium">{stat}</td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{data.count}</td>
                      <td className={`text-center py-2 px-2 font-mono ${data.hitRate > 0.52 ? "text-emerald-400" : "text-rose-400"}`}>
                        {Number(data.hitRate * 100).toFixed(1)}%
                      </td>
                      <td className={`text-center py-2 px-2 font-mono ${data.brierScore < 0.20 ? "text-emerald-400" : "text-orange-400"}`}>
                        {Number(data.brierScore).toFixed(4)}
                      </td>
                      <td className={`text-center py-2 px-2 font-mono ${data.roi > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {data.roi > 0 ? "+" : ""}{Number(data.roi * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ==================== MARKET COMPARISON SECTION ====================

function MarketComparisonSection({
  comparison,
}: {
  comparison: MarketComparisonData;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">Model vs Market Consensus</CardTitle>
          <Badge variant="outline" className="text-xs ml-auto">
            {comparison.totalCompared} props compared
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">Agreement Rate</div>
            <div className="text-2xl font-bold font-mono text-blue-400">
              {Number(comparison.agreementRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">Model agrees w/ market</div>
          </div>

          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">Disagreements</div>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {comparison.totalDisagreements}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Potential edges</div>
          </div>

          {comparison.modelCloserToActualRate !== null && (
            <div className="rounded-lg bg-card/50 border p-3">
              <div className="text-xs text-muted-foreground mb-1">Model Closer to Actual</div>
              <div className={`text-2xl font-bold font-mono ${comparison.modelCloserToActualRate > 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
                {Number(comparison.modelCloserToActualRate * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">{comparison.totalWithActuals} settled</div>
            </div>
          )}

          <div className="rounded-lg bg-card/50 border p-3">
            <div className="text-xs text-muted-foreground mb-1">Opposite Side Picks</div>
            <div className="text-2xl font-bold font-mono text-purple-400">
              {comparison.topDisagreements.filter(d => !d.sidesAgree).length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Model vs market disagree</div>
          </div>
        </div>

        {/* Top Disagreements Table */}
        {comparison.topDisagreements.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Top Market Disagreements</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="text-left py-2 px-2">Player</th>
                    <th className="text-center py-2 px-2">Stat</th>
                    <th className="text-center py-2 px-2">Model</th>
                    <th className="text-center py-2 px-2">Market</th>
                    <th className="text-center py-2 px-2">Line</th>
                    <th className="text-center py-2 px-2">Diff%</th>
                    <th className="text-center py-2 px-2">Sides</th>
                    <th className="text-center py-2 px-2">Books</th>
                    <th className="text-center py-2 px-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.topDisagreements.slice(0, 15).map((d, i) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-2 px-2 font-medium truncate max-w-[120px]">{d.playerName}</td>
                      <td className="text-center py-2 px-2 text-xs">{d.statType}</td>
                      <td className="text-center py-2 px-2 font-mono">{Number(d.modelProjection).toFixed(1)}</td>
                      <td className="text-center py-2 px-2 font-mono text-muted-foreground">{Number(d.marketConsensus).toFixed(1)}</td>
                      <td className="text-center py-2 px-2 font-mono">{Number(d.line).toFixed(1)}</td>
                      <td className={`text-center py-2 px-2 font-mono font-bold ${d.differencePct > 5 ? "text-amber-400" : "text-yellow-400"}`}>
                        {Number(d.differencePct).toFixed(1)}%
                      </td>
                      <td className="text-center py-2 px-2">
                        {d.sidesAgree ? (
                          <span className="text-xs text-muted-foreground">Agree</span>
                        ) : (
                          <Badge className="text-[10px] bg-purple-500/15 text-purple-400 border-purple-500/30">
                            Disagree
                          </Badge>
                        )}
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{d.numBooks}</td>
                      <td className="text-center py-2 px-2">
                        {d.actualValue !== null ? (
                          d.modelCorrect ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-400 inline" />
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
