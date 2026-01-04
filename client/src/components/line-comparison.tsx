import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";

interface LineComparisonProps {
  playerName: string;
  stat: string;
  lines: Array<{
    sportsbook: string;
    line: number;
    overOdds: number;
    underOdds: number;
    overImpliedProb: number;
    underImpliedProb: number;
    vig: number;
  }>;
  bestOver: {
    sportsbook: string;
    line: number;
    odds: number;
  };
  bestUnder: {
    sportsbook: string;
    line: number;
    odds: number;
  };
  consensus: {
    line: number;
    spread: number;
  };
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : odds.toString();
}

export function LineComparison(props: LineComparisonProps) {
  const { playerName, stat, lines, bestOver, bestUnder, consensus } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {playerName} - {stat.toUpperCase()} Line Shopping
        </CardTitle>
        <div className="flex gap-4 text-sm text-muted-foreground mt-2">
          <div>
            Consensus: <span className="font-semibold text-foreground">{consensus.line.toFixed(1)}</span>
          </div>
          <div>
            Spread: <span className="font-semibold text-foreground">{consensus.spread.toFixed(1)}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Best Available Lines */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border-2 border-green-500 rounded-lg p-3 bg-green-500/5">
            <div className="text-xs text-muted-foreground mb-1">Best Over</div>
            <div className="font-bold text-lg">O {bestOver.line}</div>
            <div className="text-sm">
              {formatOdds(bestOver.odds)} @ {bestOver.sportsbook}
            </div>
          </div>

          <div className="border-2 border-blue-500 rounded-lg p-3 bg-blue-500/5">
            <div className="text-xs text-muted-foreground mb-1">Best Under</div>
            <div className="font-bold text-lg">U {bestUnder.line}</div>
            <div className="text-sm">
              {formatOdds(bestUnder.odds)} @ {bestUnder.sportsbook}
            </div>
          </div>
        </div>

        {/* All Lines Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Sportsbook</th>
                <th className="text-center p-2">Line</th>
                <th className="text-center p-2">Over</th>
                <th className="text-center p-2">Under</th>
                <th className="text-center p-2">Vig</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const isBestOver = line.sportsbook === bestOver.sportsbook;
                const isBestUnder = line.sportsbook === bestUnder.sportsbook;

                return (
                  <tr key={idx} className="border-t">
                    <td className="p-2 font-medium">{line.sportsbook}</td>
                    <td className="text-center p-2">
                      <span className="font-semibold">{line.line}</span>
                    </td>
                    <td className={`text-center p-2 ${isBestOver ? 'bg-green-500/10 font-bold' : ''}`}>
                      {formatOdds(line.overOdds)}
                      <div className="text-xs text-muted-foreground">
                        {(line.overImpliedProb * 100).toFixed(1)}%
                      </div>
                    </td>
                    <td className={`text-center p-2 ${isBestUnder ? 'bg-blue-500/10 font-bold' : ''}`}>
                      {formatOdds(line.underOdds)}
                      <div className="text-xs text-muted-foreground">
                        {(line.underImpliedProb * 100).toFixed(1)}%
                      </div>
                    </td>
                    <td className="text-center p-2">
                      <Badge variant={line.vig < 0.03 ? 'default' : 'secondary'}>
                        {(line.vig * 100).toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Value Indicator */}
        {consensus.spread > 0.5 && (
          <div className="text-sm text-amber-600 dark:text-amber-500 border border-amber-500/20 bg-amber-500/5 rounded p-2">
            <strong>Line Shopping Opportunity:</strong> {consensus.spread.toFixed(1)} point spread between books
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Component for displaying line movement history
interface LineMovement {
  oldLine: number;
  newLine: number;
  lineChange: number;
  direction: 'up' | 'down' | 'odds_only';
  magnitude: number;
  isSignificant: boolean;
  detectedAt: string;
  sportsbookKey: string;
}

interface LineMovementHistoryProps {
  playerName: string;
  stat: string;
  movements: LineMovement[];
}

export function LineMovementHistory(props: LineMovementHistoryProps) {
  const { playerName, stat, movements } = props;

  if (movements.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Line Movement History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No line movements recorded</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {playerName} - {stat.toUpperCase()} Line Movements
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {movements.map((movement, idx) => (
            <div
              key={idx}
              className={`border rounded-lg p-3 ${
                movement.isSignificant ? 'border-amber-500 bg-amber-500/5' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {movement.direction === 'up' && (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  )}
                  {movement.direction === 'down' && (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                  <span className="font-medium">{movement.sportsbookKey}</span>
                </div>

                <div className="text-right">
                  <div className="font-semibold">
                    {movement.oldLine} → {movement.newLine}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {movement.lineChange > 0 ? '+' : ''}{movement.lineChange.toFixed(1)}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
                <div>
                  {new Date(movement.detectedAt).toLocaleString()}
                </div>
                {movement.isSignificant && (
                  <Badge variant="outline" className="text-xs">
                    Significant
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
