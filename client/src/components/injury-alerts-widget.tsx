import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface InjuryBeneficiary {
  playerName: string;
  stat: string;
  impact: number;
  recommendation: string;
}

interface InjuryAlert {
  team: string;
  injuries: Array<{
    playerName: string;
    status: string;
    description: string;
  }>;
  beneficiaries: InjuryBeneficiary[];
  impactLevel: "high" | "medium" | "low";
}

interface InjuryAlertsResponse {
  alerts: InjuryAlert[];
  totalInjuries: number;
  teamsAffected: number;
  highImpactAlerts: number;
  fetchedAt: string;
}

export function InjuryAlertsWidget() {
  const { data, isLoading } = useQuery<InjuryAlertsResponse>({
    queryKey: ["/api/injuries/alerts"],
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  if (isLoading) {
    return (
      <Card className="premium-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5 text-rose-400" />
            Injury Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.alerts.length === 0) {
    return (
      <Card className="premium-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5 text-emerald-400" />
            Injury Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Activity className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm text-muted-foreground">
              No high-impact injuries detected
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getImpactColor = (level: string) => {
    switch (level) {
      case "high":
        return "bg-rose-500/20 text-rose-400 border-rose-500/30";
      case "medium":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    }
  };

  return (
    <Card className="premium-card border-rose-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            Injury Alerts
            {data.highImpactAlerts > 0 && (
              <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">
                {data.highImpactAlerts} High Impact
              </Badge>
            )}
          </CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {data.totalInjuries} injuries across {data.teamsAffected} teams
        </p>
      </CardHeader>
      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
        {data.alerts.slice(0, 5).map((alert, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-lg border ${
              alert.impactLevel === "high"
                ? "bg-rose-500/10 border-rose-500/30"
                : alert.impactLevel === "medium"
                ? "bg-amber-500/10 border-amber-500/30"
                : "bg-muted/30 border-border/50"
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm">{alert.team}</span>
                  <Badge variant="outline" className={getImpactColor(alert.impactLevel)}>
                    {alert.impactLevel.toUpperCase()}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {alert.injuries.map((inj, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-rose-400">OUT:</span>
                      <span>{inj.playerName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {alert.beneficiaries.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Betting Opportunities:
                </div>
                <div className="space-y-1">
                  {alert.beneficiaries.map((ben, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs bg-background/50 rounded px-2 py-1"
                    >
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-emerald-400" />
                        <span className="font-medium">{ben.playerName}</span>
                        <span className="text-muted-foreground">{ben.stat.toUpperCase()}</span>
                      </div>
                      <span className="text-emerald-400 font-bold">
                        +{ben.impact.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
