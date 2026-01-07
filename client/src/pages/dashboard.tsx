import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropCard } from "@/components/prop-card";
import { Badge } from "@/components/ui/badge";
import type { PotentialBet } from "@shared/schema";
import { Loader2, Flame, TrendingUp, TrendingDown } from "lucide-react";

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

async function fetchTopPicks(): Promise<PotentialBet[]> {
  const response = await fetch('/api/bets/top-picks');
  if (!response.ok) throw new Error('Failed to fetch top picks');
  return response.json();
}

function getEdgeBadgeColor(edgeType: string | undefined) {
  if (!edgeType) return "";
  if (edgeType === "STAR_OUT") return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (edgeType === "BACK_TO_BACK") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (edgeType === "BLOWOUT_RISK") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (edgeType === "PACE_MATCHUP") return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
  if (edgeType === "BAD_DEFENSE") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (edgeType === "MINUTES_STABILITY") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (edgeType === "HOME_ROAD_SPLIT") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-primary/20 text-primary border-primary/30";
}

function getEdgeLabel(edgeType: string | undefined) {
  if (!edgeType) return "";
  return edgeType.replace(/_/g, " ");
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
  const { data: topPicks, isLoading: picksLoading } = useQuery({
    queryKey: ['/api/bets/top-picks'],
    queryFn: fetchTopPicks,
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

      {/* Best Picks - Edge-Based Analysis */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Top 10 Best Picks</CardTitle>
            <div className="text-sm text-muted-foreground">
              Edge-based analysis
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {picksLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : topPicks && topPicks.length > 0 ? (
            <div className="space-y-3">
              {topPicks.map((bet, idx) => {
                const isOver = bet.recommendation === "OVER";
                return (
                  <div key={idx} className="p-4 rounded-lg bg-gradient-to-r from-primary/10 to-transparent border border-primary/30 hover:border-primary/50 transition-all">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-muted-foreground">#{idx + 1}</span>
                          <span className="font-bold text-lg">{bet.player_name}</span>
                          <Badge variant="outline" className="text-xs">{bet.team}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <span>{bet.stat_type}</span>
                          <span className="font-mono font-bold text-foreground">{bet.line}</span>
                          <span>•</span>
                          <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${isOver ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"}`}>
                            {isOver ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {bet.recommendation}
                          </div>
                        </div>
                        {bet.edge_description && (
                          <div className="text-sm text-primary italic">
                            {bet.edge_description}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {bet.edge_type && (
                            <Badge className={`${getEdgeBadgeColor(bet.edge_type)} text-xs px-2 capitalize`}>
                              {getEdgeLabel(bet.edge_type)}
                            </Badge>
                          )}
                          {bet.confidence === "HIGH" && (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs px-2">
                              <Flame className="w-3 h-3 mr-1" />
                              HIGH
                            </Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Hit Rate</div>
                          <div className={`font-mono text-lg font-bold ${bet.hit_rate >= 70 ? 'text-emerald-400' : 'text-foreground'}`}>
                            {bet.hit_rate.toFixed(0)}%
                          </div>
                        </div>
                        {bet.edge_score && (
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Edge Score</div>
                            <div className="font-mono text-sm font-bold text-primary">
                              {bet.edge_score.toFixed(1)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg">No edge plays available</p>
              <p className="text-sm mt-2">Check back later or sync player data</p>
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
