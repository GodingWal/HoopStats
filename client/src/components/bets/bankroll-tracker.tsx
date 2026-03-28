import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Wallet,
  Settings,
  ChevronDown,
  ChevronUp,
  Zap,
  BarChart3,
  Calendar,
  Award,
  AlertTriangle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface BankrollSummary {
  totalProfit: number;
  totalRisked: number;
  roi: number;
  winRate: number;
  totalParlays: number;
  wins: number;
  losses: number;
  todayPL: number;
  currentStreak: number;
  streakType: "win" | "loss" | "none";
  pickHitRate: number;
  totalPicks: number;
  hitPicks: number;
  bestDay: { date: string; profit: number } | null;
  worstDay: { date: string; profit: number } | null;
  kellyRecommendations: Array<{
    tier: string;
    fullKellyPct: number;
    quarterKellyPct: number;
    recommendedUnit: number;
  }>;
}

interface BankrollHistory {
  startingBankroll: number;
  currentBalance: number;
  history: Array<{
    date: string;
    balance: number;
    dailyPL: number;
    bets: number;
    wins: number;
    losses: number;
  }>;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCurrency(amount: number): string {
  const prefix = amount >= 0 ? "+$" : "-$";
  return prefix + Number(Math.abs(amount)).toFixed(2);
}

// Custom tooltip for the chart
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-xl text-sm">
      <div className="font-semibold mb-1">{formatDate(data.date)}</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Balance:</span>
          <span className="font-mono font-bold">${Number(data.balance).toFixed(2)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Day P/L:</span>
          <span className={`font-mono font-bold ${data.dailyPL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {formatCurrency(data.dailyPL)}
          </span>
        </div>
        {data.bets > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Record:</span>
            <span className="font-mono">{data.wins}W-{data.losses}L</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function BankrollSummaryCard() {
  const [startingBankroll, setStartingBankroll] = useState<number>(() => {
    const saved = localStorage.getItem("courtsideedge_bankroll");
    return saved ? Number(saved) : 1000;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const [inputValue, setInputValue] = useState(String(startingBankroll));

  const { data: summary } = useQuery<BankrollSummary>({
    queryKey: ["/api/bankroll/summary"],
    refetchInterval: 60000,
  });

  const { data: history } = useQuery<BankrollHistory>({
    queryKey: ["/api/bankroll/history", `?startingBankroll=${startingBankroll}`],
    refetchInterval: 60000,
  });

  const saveBankroll = (value: number) => {
    setStartingBankroll(value);
    localStorage.setItem("courtsideedge_bankroll", String(value));
  };

  const handleSaveSettings = () => {
    const val = parseFloat(inputValue);
    if (!isNaN(val) && val > 0) {
      saveBankroll(val);
      setShowSettings(false);
    }
  };

  if (!summary) return null;

  const currentBalance = history?.currentBalance ?? startingBankroll;
  const profitLoss = currentBalance - startingBankroll;
  const isUp = profitLoss >= 0;

  // Calculate Kelly-based unit sizes for current bankroll
  const unitRecommendations = summary.kellyRecommendations.map(rec => ({
    ...rec,
    recommendedUnit: Number((currentBalance * rec.quarterKellyPct / 100).toFixed(2)),
  }));

  // Prepare chart data with color segments
  const chartData = history?.history || [];

  return (
    <div className="space-y-4 mb-6">
      {/* Main Bankroll Card */}
      <Card className="premium-card border-primary/20 overflow-hidden">
        <div className={`h-1 w-full ${isUp ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-rose-500 to-rose-400"}`} />
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Bankroll Tracker</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowChart(!showChart)}
                className="text-xs h-7 px-2"
              >
                <BarChart3 className="w-3.5 h-3.5 mr-1" />
                {showChart ? "Hide" : "Show"} Chart
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
                className="text-xs h-7 px-2"
              >
                <Settings className="w-3.5 h-3.5 mr-1" />
                Settings
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Settings Panel */}
          {showSettings && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border/50 space-y-3">
              <div className="text-sm font-medium">Bankroll Settings</div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground whitespace-nowrap">Starting Bankroll:</label>
                <div className="relative flex-1 max-w-[200px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <input
                    type="number"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 rounded-md border bg-background text-sm"
                    min="1"
                    step="100"
                  />
                </div>
                <Button size="sm" onClick={handleSaveSettings} className="h-8">
                  Save
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Set your initial bankroll to track profit/loss and get Kelly-based unit sizing recommendations.
              </div>
            </div>
          )}

          {/* Quick Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-xs text-muted-foreground mb-1">Current Balance</div>
              <div className={`text-xl font-bold font-mono ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                ${Number(currentBalance).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Started: ${Number(startingBankroll).toFixed(0)}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
              <div className={`text-xl font-bold font-mono flex items-center gap-1 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {formatCurrency(profitLoss)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                ROI: {summary.roi >= 0 ? "+" : ""}{Number(summary.roi).toFixed(1)}%
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-xs text-muted-foreground mb-1">Today</div>
              <div className={`text-xl font-bold font-mono ${summary.todayPL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {formatCurrency(summary.todayPL)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Streak: {summary.currentStreak > 0 ? `${summary.currentStreak}W` : summary.currentStreak < 0 ? `${Math.abs(summary.currentStreak)}L` : "---"}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-xs text-muted-foreground mb-1">Record</div>
              <div className="text-xl font-bold font-mono">
                <span className="text-emerald-400">{summary.wins}</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-rose-400">{summary.losses}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Win Rate: {Number(summary.winRate).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Bankroll Chart */}
          {showChart && chartData.length > 1 && (
            <div className="pt-2">
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <defs>
                      <linearGradient id="bankrollGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="bankrollRed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      tickFormatter={(v: number) => `$${v}`}
                      domain={["dataMin - 20", "dataMax + 20"]}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine
                      y={startingBankroll}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="5 5"
                      strokeOpacity={0.5}
                      label={{
                        value: "Start",
                        position: "left",
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 10,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke={isUp ? "#10b981" : "#f43f5e"}
                      strokeWidth={2}
                      fill={isUp ? "url(#bankrollGreen)" : "url(#bankrollRed)"}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Additional Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Best/Worst Day */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Notable Days
              </div>
              <div className="space-y-1.5">
                {summary.bestDay && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-muted-foreground">Best:</span>
                      <span>{formatDate(summary.bestDay.date)}</span>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">
                      +${Number(summary.bestDay.profit).toFixed(2)}
                    </span>
                  </div>
                )}
                {summary.worstDay && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                      <span className="text-muted-foreground">Worst:</span>
                      <span>{formatDate(summary.worstDay.date)}</span>
                    </div>
                    <span className="font-mono font-bold text-rose-400">
                      -${Number(Math.abs(summary.worstDay.profit)).toFixed(2)}
                    </span>
                  </div>
                )}
                {!summary.bestDay && !summary.worstDay && (
                  <div className="text-sm text-muted-foreground">No settled bets yet</div>
                )}
              </div>
            </div>

            {/* Kelly Unit Sizing */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" />
                Recommended Unit Size (Quarter Kelly)
              </div>
              <div className="space-y-1.5">
                {unitRecommendations.map((rec) => (
                  <div key={rec.tier} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          rec.tier === "HIGH"
                            ? "border-emerald-500/50 text-emerald-400"
                            : rec.tier === "MEDIUM"
                            ? "border-yellow-500/50 text-yellow-400"
                            : "border-muted-foreground/50 text-muted-foreground"
                        }`}
                      >
                        {rec.tier}
                      </Badge>
                      <span className="text-muted-foreground">
                        ({Number(rec.quarterKellyPct).toFixed(1)}%)
                      </span>
                    </div>
                    <span className="font-mono font-bold">
                      ${Number(rec.recommendedUnit).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pick Hit Rate */}
          {summary.totalPicks > 0 && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/20 text-sm">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">Individual Pick Hit Rate:</span>
              </div>
              <div className="font-mono font-bold">
                {Number(summary.pickHitRate).toFixed(1)}%
                <span className="text-muted-foreground font-normal ml-1">
                  ({summary.hitPicks}/{summary.totalPicks})
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

