import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropCard } from "@/components/prop-card";
import { Loader2 } from "lucide-react";

interface Recommendation {
  playerId: number;
  playerName: string;
  stat: string;
  line: number;
  side: 'over' | 'under';
  edge: number;
  confidence: 'high' | 'medium' | 'low';
  projectionId?: number;
}

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
}

async function fetchTodaysRecommendations(): Promise<Recommendation[]> {
  const response = await fetch('/api/recommendations/today?minEdge=0.03');
  if (!response.ok) throw new Error('Failed to fetch recommendations');
  return response.json();
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

export default function Dashboard() {
  const { data: recommendations, isLoading: recsLoading } = useQuery({
    queryKey: ['recommendations-today'],
    queryFn: fetchTodaysRecommendations,
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: trackRecord, isLoading: recordLoading } = useQuery({
    queryKey: ['track-record', 30],
    queryFn: () => fetchTrackRecord(30),
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Betting Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {new Date().toLocaleTimeString()}
        </p>
      </div>

      {/* Track Record Summary */}
      <Card>
        <CardHeader>
          <CardTitle>30-Day Track Record</CardTitle>
        </CardHeader>
        <CardContent>
          {recordLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : trackRecord && trackRecord.total > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Record"
                value={`${trackRecord.wins}-${trackRecord.losses}`}
              />
              <StatCard
                label="Hit Rate"
                value={`${(trackRecord.hitRate * 100).toFixed(1)}%`}
                highlight={trackRecord.hitRate > 0.524}
              />
              <StatCard
                label="ROI"
                value={`${(trackRecord.roi * 100).toFixed(1)}%`}
                highlight={trackRecord.roi > 0}
              />
              <StatCard
                label="Profit"
                value={`${trackRecord.profit >= 0 ? '+' : ''}${trackRecord.profit.toFixed(1)}u`}
                highlight={trackRecord.profit > 0}
              />
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No track record data yet.</p>
              <p className="text-sm mt-2">Start logging predictions to build your track record.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Today's Best Bets */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Today's Best Plays</CardTitle>
            <div className="text-sm text-muted-foreground">
              {recommendations?.length || 0} opportunities
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {recsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : recommendations && recommendations.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommendations.map((rec, idx) => (
                <PropCard
                  key={idx}
                  playerId={rec.playerId}
                  playerName={rec.playerName}
                  stat={rec.stat}
                  line={rec.line}
                  side={rec.side}
                  projectedMean={0}  // These would come from the projection
                  projectedStd={0}
                  probOver={0}
                  probUnder={0}
                  edge={rec.edge}
                  confidence={rec.confidence}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg">No strong plays today</p>
              <p className="text-sm mt-2">Check back later or lower the edge threshold</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Confidence Breakdown */}
      {trackRecord && trackRecord.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Performance by Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(trackRecord.byConfidence).map(([conf, stats]) => (
                <div key={conf} className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-2 capitalize">{conf}</h3>
                  {stats.total > 0 ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Record:</span>
                        <span className="font-medium">{stats.wins}-{stats.total - stats.wins}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hit Rate:</span>
                        <span className="font-medium">{(stats.hitRate * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No data</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
