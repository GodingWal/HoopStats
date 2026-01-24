/**
 * Injury Impact Component
 *
 * Displays how teammates perform when a star player sits out.
 * Shows WITH vs WITHOUT splits for points, rebounds, assists, minutes, and FGA.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface InjuryImpactProps {
  injuredPlayerId: number;
  injuredPlayerName: string;
  team?: string;
  season?: string;
}

interface PlayerSplit {
  id: number;
  playerId: number;
  playerName: string;
  team: string;
  withoutPlayerId: number;
  withoutPlayerName: string;
  season: string;
  gamesWithTeammate: number;
  gamesWithoutTeammate: number;
  ptsWithTeammate: number | null;
  rebWithTeammate: number | null;
  astWithTeammate: number | null;
  minWithTeammate: number | null;
  fgaWithTeammate: number | null;
  ptsWithoutTeammate: number;
  rebWithoutTeammate: number;
  astWithoutTeammate: number;
  minWithoutTeammate: number;
  fgaWithoutTeammate: number;
  ptsDelta: number | null;
  rebDelta: number | null;
  astDelta: number | null;
  minDelta: number | null;
  fgaDelta: number | null;
  calculatedAt: string;
  updatedAt: string;
}

interface StatDeltaProps {
  label: string;
  withValue: number | null;
  withoutValue: number;
  delta: number | null;
}

function StatDelta({ label, withValue, withoutValue, delta }: StatDeltaProps) {
  const getDeltaColor = (d: number | null) => {
    if (d === null) return "text-muted-foreground";
    if (d > 0) return "text-emerald-500";
    if (d < 0) return "text-red-500";
    return "text-muted-foreground";
  };

  const getDeltaIcon = (d: number | null) => {
    if (d === null || d === 0) return <Minus className="w-3 h-3" />;
    if (d > 0) return <TrendingUp className="w-3 h-3" />;
    return <TrendingDown className="w-3 h-3" />;
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {withValue !== null && (
        <div className="text-xs text-muted-foreground">
          {withValue.toFixed(1)}
        </div>
      )}
      <div className="text-sm font-semibold">
        {withoutValue.toFixed(1)}
      </div>
      <div className={`flex items-center gap-1 text-xs font-medium ${getDeltaColor(delta)}`}>
        {getDeltaIcon(delta)}
        {delta !== null ? (
          <span>{delta > 0 ? '+' : ''}{delta.toFixed(1)}</span>
        ) : (
          <span>-</span>
        )}
      </div>
    </div>
  );
}

export function InjuryImpact({ injuredPlayerId, injuredPlayerName, season }: InjuryImpactProps) {
  const { data, isLoading, error } = useQuery<{ splits: PlayerSplit[]; count: number }>({
    queryKey: ['splits', injuredPlayerId, season],
    queryFn: async () => {
      const url = season
        ? `/api/splits/without-player/${injuredPlayerId}?season=${season}`
        : `/api/splits/without-player/${injuredPlayerId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch splits');
      return response.json();
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Injury Impact Analysis</CardTitle>
          <CardDescription>Loading splits data...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Injury Impact Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Failed to load splits data</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const splits = data?.splits || [];

  if (splits.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Injury Impact Analysis</CardTitle>
          <CardDescription>
            Stat changes when {injuredPlayerName} sits out
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No splits data available for this player.
            </p>
            <p className="text-xs text-muted-foreground mt-2 max-w-sm">
              This feature requires a database connection with historical on/off splits data.
              To calculate splits, use the <code className="bg-muted px-1 rounded text-xs">/api/splits/calculate/{'{playerId}'}</code> endpoint
              or run the historical splits script.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              If DATABASE_URL is not set, splits cannot be stored or retrieved.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Injury Impact Analysis</CardTitle>
        <CardDescription>
          How teammates perform when {injuredPlayerName} sits out
          <span className="text-xs ml-2">({splits[0]?.season || 'Current Season'})</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {splits.map((split) => (
            <div
              key={split.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="flex flex-col">
                  <span className="font-medium">{split.playerName}</span>
                  <span className="text-xs text-muted-foreground">
                    {split.gamesWithoutTeammate} games without · {split.gamesWithTeammate} games with
                  </span>
                </div>
                {split.ptsDelta !== null && split.ptsDelta >= 2.0 && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    Major Beneficiary
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-6">
                <StatDelta
                  label="PTS"
                  withValue={split.ptsWithTeammate}
                  withoutValue={split.ptsWithoutTeammate}
                  delta={split.ptsDelta}
                />
                <StatDelta
                  label="REB"
                  withValue={split.rebWithTeammate}
                  withoutValue={split.rebWithoutTeammate}
                  delta={split.rebDelta}
                />
                <StatDelta
                  label="AST"
                  withValue={split.astWithTeammate}
                  withoutValue={split.astWithoutTeammate}
                  delta={split.astDelta}
                />
                <StatDelta
                  label="MIN"
                  withValue={split.minWithTeammate}
                  withoutValue={split.minWithoutTeammate}
                  delta={split.minDelta}
                />
                <StatDelta
                  label="FGA"
                  withValue={split.fgaWithTeammate}
                  withoutValue={split.fgaWithoutTeammate}
                  delta={split.fgaDelta}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
