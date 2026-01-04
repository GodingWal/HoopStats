import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PropCardProps {
  playerId: number;
  playerName: string;
  stat: string;
  line: number;
  side: 'over' | 'under';
  projectedMean: number;
  projectedStd: number;
  probOver: number;
  probUnder: number;
  edge: number;
  confidence: 'high' | 'medium' | 'low';
}

export function PropCard(prop: PropCardProps) {
  const edgeColor =
    prop.edge > 0.06 ? 'bg-green-500' :
    prop.edge > 0.03 ? 'bg-yellow-500' :
    'bg-gray-500';

  const confidenceColor =
    prop.confidence === 'high' ? 'bg-green-600' :
    prop.confidence === 'medium' ? 'bg-yellow-600' :
    'bg-gray-600';

  const displayProb = prop.side === 'over' ? prop.probOver : prop.probUnder;

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-lg">{prop.playerName}</h3>
            <p className="text-sm text-muted-foreground">
              {prop.stat.toUpperCase()} {prop.side.toUpperCase()} {prop.line}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge className={`${edgeColor} text-white`}>
              {(prop.edge * 100).toFixed(1)}% edge
            </Badge>
            <Badge className={`${confidenceColor} text-white`}>
              {prop.confidence.toUpperCase()}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Probability visualization */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              Under: {(prop.probUnder * 100).toFixed(0)}%
            </span>
            <span className="text-muted-foreground">
              Over: {(prop.probOver * 100).toFixed(0)}%
            </span>
          </div>
          <div className="h-2 bg-secondary rounded overflow-hidden">
            <div
              className="h-full bg-primary rounded transition-all"
              style={{ width: `${prop.probOver * 100}%` }}
            />
          </div>
        </div>

        {/* Projection details */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-muted-foreground">Projection</p>
            <p className="font-semibold">{prop.projectedMean.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Hit Probability</p>
            <p className="font-semibold">{(displayProb * 100).toFixed(1)}%</p>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Range: {(prop.projectedMean - prop.projectedStd).toFixed(1)} - {(prop.projectedMean + prop.projectedStd).toFixed(1)}
        </div>

        {/* Action button */}
        {prop.edge >= 0.03 && (
          <Button className="w-full mt-2" variant="outline" size="sm">
            View on Sportsbooks →
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
