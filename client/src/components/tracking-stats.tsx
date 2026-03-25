import { useQuery } from "@tanstack/react-query";
import type { TrackingStats } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface TrackingStatsProps {
  playerId: number;
  playerName: string;
}

function ProgressBar({ value, max = 100, color = "bg-primary" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full bg-muted/40 rounded-full h-2">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MetricCard({ title, value, subtitle, color }: { title: string; value: string; subtitle: string; color?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color || ''}`}>{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

export function TrackingStatsPanel({ playerId, playerName }: TrackingStatsProps) {
  const { data: stats, isLoading, isError } = useQuery<TrackingStats>({
    queryKey: [`/api/stats/tracking/${playerId}`],
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading tracking stats...</span>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg">
        No tracking stats available for {playerName}
      </div>
    );
  }

  const { shotQuality, defensiveMatchup, synergyLineup } = stats;

  return (
    <div className="space-y-6">
      {/* Shot Quality Section */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          Shot Quality (qSQ)
          <Badge variant="outline" className="text-xs font-normal">
            {shotQuality.archetype.replace(/_/g, ' ')}
          </Badge>
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard
            title="qSQ Score"
            value={(shotQuality.qsq * 100).toFixed(0)}
            subtitle="Shot quality composite (0-100)"
            color={shotQuality.qsq > 0.6 ? 'text-emerald-500' : shotQuality.qsq < 0.4 ? 'text-red-500' : ''}
          />
          <MetricCard
            title="Shot Quality Delta"
            value={`${shotQuality.shotQualityDelta > 0 ? '+' : ''}${(shotQuality.shotQualityDelta * 100).toFixed(1)}%`}
            subtitle={
              shotQuality.regressionSignal === "OVER"
                ? "Underperforming - regression UP likely"
                : shotQuality.regressionSignal === "UNDER"
                  ? "Overperforming - regression DOWN likely"
                  : "Performing as expected"
            }
            color={
              shotQuality.regressionSignal === "OVER"
                ? 'text-emerald-500'
                : shotQuality.regressionSignal === "UNDER"
                  ? 'text-red-500'
                  : ''
            }
          />
          <MetricCard
            title="Regression Signal"
            value={shotQuality.regressionSignal}
            subtitle={`Magnitude: ${(shotQuality.regressionMagnitude * 100).toFixed(0)}%`}
            color={
              shotQuality.regressionSignal === "OVER"
                ? 'text-emerald-500'
                : shotQuality.regressionSignal === "UNDER"
                  ? 'text-yellow-500'
                  : 'text-muted-foreground'
            }
          />
        </div>

        {/* Shot Distribution */}
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Shot Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Rim Attempts</span>
              <span className="font-mono">{(shotQuality.rimRate * 100).toFixed(0)}%</span>
            </div>
            <ProgressBar value={shotQuality.rimRate * 100} color="bg-emerald-500" />

            <div className="flex items-center justify-between text-sm">
              <span>3-Point Rate</span>
              <span className="font-mono">{(shotQuality.threePointRate * 100).toFixed(0)}%</span>
            </div>
            <ProgressBar value={shotQuality.threePointRate * 100} color="bg-blue-500" />

            <div className="flex items-center justify-between text-sm">
              <span>Midrange</span>
              <span className="font-mono">{(shotQuality.midrangeRate * 100).toFixed(0)}%</span>
            </div>
            <ProgressBar value={shotQuality.midrangeRate * 100} color="bg-yellow-500" />

            <div className="flex items-center justify-between text-sm">
              <span>Free Throw Rate</span>
              <span className="font-mono">{(shotQuality.freeThrowRate * 100).toFixed(0)}%</span>
            </div>
            <ProgressBar value={shotQuality.freeThrowRate * 100} max={50} color="bg-purple-500" />

            <div className="flex items-center justify-between text-sm pt-2 border-t">
              <span className="font-medium">Expected eFG%</span>
              <span className="font-mono">{(shotQuality.expectedEfg * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Actual eFG%</span>
              <span className={`font-mono font-bold ${shotQuality.actualEfg > shotQuality.expectedEfg ? 'text-emerald-500' : shotQuality.actualEfg < shotQuality.expectedEfg ? 'text-red-500' : ''}`}>
                {(shotQuality.actualEfg * 100).toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Defensive Matchup Section */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          Defensive Matchup
          {defensiveMatchup.schemeName !== "unknown" && (
            <Badge variant="outline" className="text-xs font-normal capitalize">
              {defensiveMatchup.schemeName} scheme
            </Badge>
          )}
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Aggression+</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${defensiveMatchup.aggressionPlus > 70 ? 'text-red-500' : defensiveMatchup.aggressionPlus < 40 ? 'text-emerald-500' : 'text-yellow-500'}`}>
                {defensiveMatchup.aggressionPlus}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Double-team / trap frequency</p>
              <ProgressBar value={defensiveMatchup.aggressionPlus} color={defensiveMatchup.aggressionPlus > 70 ? 'bg-red-500' : defensiveMatchup.aggressionPlus < 40 ? 'bg-emerald-500' : 'bg-yellow-500'} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Variance+</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${defensiveMatchup.variancePlus > 65 ? 'text-yellow-500' : ''}`}>
                {defensiveMatchup.variancePlus}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Coverage switch frequency</p>
              <ProgressBar value={defensiveMatchup.variancePlus} color={defensiveMatchup.variancePlus > 65 ? 'bg-yellow-500' : 'bg-blue-500'} />
            </CardContent>
          </Card>
          <MetricCard
            title="Matchup Difficulty"
            value={`${(defensiveMatchup.matchupDifficulty * 100).toFixed(0)}/100`}
            subtitle={defensiveMatchup.matchupDifficulty > 0.6 ? 'Tough matchup' : defensiveMatchup.matchupDifficulty < 0.35 ? 'Favorable matchup' : 'Average matchup'}
            color={defensiveMatchup.matchupDifficulty > 0.6 ? 'text-red-500' : defensiveMatchup.matchupDifficulty < 0.35 ? 'text-emerald-500' : ''}
          />
          <MetricCard
            title="Opp Def Rating"
            value={defensiveMatchup.oppDefRating.toFixed(1)}
            subtitle={`Rank: #${defensiveMatchup.oppDefRank}/30`}
            color={defensiveMatchup.oppDefRating < 110 ? 'text-red-500' : defensiveMatchup.oppDefRating > 114 ? 'text-emerald-500' : ''}
          />
          <MetricCard
            title="Pace Factor"
            value={`${defensiveMatchup.paceAdjFactor.toFixed(2)}x`}
            subtitle={defensiveMatchup.paceAdjFactor > 1.02 ? 'Fast pace boosts counting stats' : defensiveMatchup.paceAdjFactor < 0.98 ? 'Slow pace limits volume' : 'Average pace'}
          />
          <MetricCard
            title="Position Defense"
            value={`${(defensiveMatchup.positionDefense * 100).toFixed(0)}%`}
            subtitle="How well opp guards this position"
            color={defensiveMatchup.positionDefense > 0.6 ? 'text-red-500' : 'text-emerald-500'}
          />
        </div>

        {/* Scheme Impact on Stats */}
        {Object.keys(defensiveMatchup.schemeImpact).length > 0 && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
                Scheme Impact on Stats ({defensiveMatchup.schemeName})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-3">
                {Object.entries(defensiveMatchup.schemeImpact).map(([stat, mult]) => (
                  <div key={stat} className="text-center">
                    <div className="text-xs text-muted-foreground uppercase">{stat}</div>
                    <div className={`text-lg font-mono font-bold ${mult > 1.02 ? 'text-emerald-500' : mult < 0.98 ? 'text-red-500' : ''}`}>
                      {mult > 1 ? '+' : ''}{((mult - 1) * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Synergy / Lineup Section */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          Synergy / Lineup
          <Badge variant="outline" className="text-xs font-normal">
            {synergyLineup.opponentCluster}
          </Badge>
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard
            title="Projected Minutes"
            value={synergyLineup.projectedMinutes.toFixed(1)}
            subtitle={`Range: ${synergyLineup.minutesFloor.toFixed(0)}-${synergyLineup.minutesCeiling.toFixed(0)} min`}
          />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Rotation Stability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${synergyLineup.minutesStability > 0.7 ? 'text-emerald-500' : synergyLineup.minutesStability < 0.4 ? 'text-red-500' : 'text-yellow-500'}`}>
                {(synergyLineup.minutesStability * 100).toFixed(0)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">How predictable is the role</p>
              <ProgressBar value={synergyLineup.minutesStability * 100} color={synergyLineup.minutesStability > 0.7 ? 'bg-emerald-500' : 'bg-yellow-500'} />
            </CardContent>
          </Card>
          <MetricCard
            title="Role Score"
            value={synergyLineup.roleScore >= 1.0 ? "Star" : synergyLineup.roleScore >= 0.75 ? "Starter" : synergyLineup.roleScore >= 0.50 ? "Rotation" : "Bench"}
            subtitle={`Score: ${synergyLineup.roleScore.toFixed(2)}`}
            color={synergyLineup.roleScore >= 0.75 ? 'text-emerald-500' : synergyLineup.roleScore < 0.25 ? 'text-red-500' : ''}
          />
          <MetricCard
            title="Blowout Risk"
            value={`${(synergyLineup.blowoutRisk * 100).toFixed(0)}%`}
            subtitle="Chance of reduced minutes from blowout"
            color={synergyLineup.blowoutRisk > 0.25 ? 'text-yellow-500' : ''}
          />
          <MetricCard
            title="Lineup Impact"
            value={synergyLineup.lineupImpact > 0 ? `+${synergyLineup.lineupImpact}` : `${synergyLineup.lineupImpact}`}
            subtitle="Net rating impact from lineup context"
            color={synergyLineup.lineupImpact > 3 ? 'text-emerald-500' : synergyLineup.lineupImpact < -3 ? 'text-red-500' : ''}
          />
          <MetricCard
            title="Opp Cluster"
            value={synergyLineup.opponentCluster.replace(/-/g, ' ')}
            subtitle="Defensive archetype classification"
          />
        </div>

        {/* Teammates Out Impact */}
        {synergyLineup.teammatesOut.length > 0 && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Teammate Absence Impact</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {synergyLineup.teammatesOut.map((tm) => (
                  <div key={tm.name} className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
                    <span className="text-sm font-medium">{tm.name}</span>
                    <div className="flex gap-4 text-sm">
                      <span className={tm.statImpact > 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {tm.statImpact > 0 ? '+' : ''}{tm.statImpact} stat boost
                      </span>
                      <span className="text-muted-foreground">
                        +{tm.minutesImpact} min
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
