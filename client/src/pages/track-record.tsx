import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { Loader2 } from "lucide-react";

interface TrackRecord {
  total: number;
  wins: number;
  losses: number;
  hitRate: number;
  roi: number;
  profit: number;
  byConfidence: {
    high: { wins: number; total: number; hitRate: number };
    medium: { wins: number; total: number; hitRate: number };
    low: { wins: number; total: number; hitRate: number };
  };
  byStat: Record<string, { wins: number; total: number; hitRate: number }>;
  equityCurve: Array<{ date: string; profit: number }>;
  calibration: Array<{ predicted: number; actual: number; count: number }>;
}

async function fetchTrackRecord(days: number = 30): Promise<TrackRecord> {
  const response = await fetch(`/api/track-record?days=${days}`);
  if (!response.ok) throw new Error('Failed to fetch track record');
  return response.json();
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-lg border ${highlight ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}

export default function TrackRecord() {
  const { data: record, isLoading } = useQuery({
    queryKey: ['track-record-full', 90],
    queryFn: () => fetchTrackRecord(90),
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!record || record.total === 0) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Track Record</h1>
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-xl text-muted-foreground mb-4">No track record data yet</p>
            <p className="text-sm text-muted-foreground">
              Start logging predictions and their outcomes to build your verified track record.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statData = Object.entries(record.byStat).map(([stat, data]) => ({
    stat: stat.toUpperCase(),
    hitRate: data.hitRate * 100,
    total: data.total,
  }));

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Verified Track Record</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Last 90 days. All predictions timestamped before game time.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Bets"
          value={record.total.toString()}
        />
        <StatCard
          label="Record"
          value={`${record.wins}-${record.losses}`}
        />
        <StatCard
          label="Hit Rate"
          value={`${(record.hitRate * 100).toFixed(1)}%`}
          highlight={record.hitRate > 0.524}
        />
        <StatCard
          label="ROI"
          value={`${(record.roi * 100).toFixed(1)}%`}
          highlight={record.roi > 0}
        />
      </div>

      {/* Equity Curve */}
      <Card>
        <CardHeader>
          <CardTitle>Profit Curve (Units)</CardTitle>
        </CardHeader>
        <CardContent>
          {record.equityCurve.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={record.equityCurve}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  labelFormatter={(value) => new Date(value).toLocaleDateString()}
                  formatter={(value: number) => [`${value.toFixed(2)} units`, 'Profit']}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center py-12 text-muted-foreground">Not enough data for equity curve</p>
          )}
        </CardContent>
      </Card>

      {/* Performance by Stat Type */}
      <Card>
        <CardHeader>
          <CardTitle>Hit Rate by Stat Type</CardTitle>
        </CardHeader>
        <CardContent>
          {statData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={statData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stat" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === 'hitRate') return [`${value.toFixed(1)}%`, 'Hit Rate'];
                    return [value, name];
                  }}
                />
                <Bar dataKey="hitRate" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center py-12 text-muted-foreground">No stat breakdown available</p>
          )}
        </CardContent>
      </Card>

      {/* Performance by Confidence */}
      <Card>
        <CardHeader>
          <CardTitle>Performance by Confidence Level</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(record.byConfidence).map(([conf, stats]) => (
              <div
                key={conf}
                className={`p-6 border-2 rounded-lg ${
                  conf === 'high' ? 'border-green-500' :
                  conf === 'medium' ? 'border-yellow-500' :
                  'border-gray-500'
                }`}
              >
                <h3 className="font-semibold text-lg mb-3 capitalize">{conf} Confidence</h3>
                {stats.total > 0 ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Record:</span>
                      <span className="font-bold text-lg">{stats.wins}-{stats.total - stats.wins}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Hit Rate:</span>
                      <span className={`font-bold text-lg ${stats.hitRate > 0.524 ? 'text-green-600' : ''}`}>
                        {(stats.hitRate * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-secondary rounded h-2 mt-2">
                      <div
                        className={`h-full rounded ${
                          conf === 'high' ? 'bg-green-500' :
                          conf === 'medium' ? 'bg-yellow-500' :
                          'bg-gray-500'
                        }`}
                        style={{ width: `${stats.hitRate * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No bets yet</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Calibration Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Probability Calibration</CardTitle>
          <p className="text-sm text-muted-foreground">
            When we say 60%, it should hit ~60% of the time
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={record.calibration}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="predicted"
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              />
              <Tooltip
                formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                name="Perfect Calibration"
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                name="Actual"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Statistical Details */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3">Overall Performance</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Profit/Loss:</span>
                  <span className={`font-medium ${record.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {record.profit >= 0 ? '+' : ''}{record.profit.toFixed(2)} units
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average Bet ROI:</span>
                  <span className="font-medium">{(record.roi * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Win Rate:</span>
                  <span className="font-medium">{(record.hitRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Break-even Line:</span>
                  <span className="font-medium">52.4%</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-3">By Stat Type</h4>
              <div className="space-y-2 text-sm">
                {Object.entries(record.byStat).map(([stat, data]) => (
                  <div key={stat} className="flex justify-between">
                    <span className="text-muted-foreground">{stat.toUpperCase()}:</span>
                    <span className="font-medium">
                      {data.wins}-{data.total - data.wins} ({(data.hitRate * 100).toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
