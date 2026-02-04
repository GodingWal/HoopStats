import type { GameLog } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RecentGamesTableProps {
  games: GameLog[];
  seasonAvg?: {
    PTS: number;
    REB: number;
    AST: number;
    FG3M: number;
    STL?: number;
    BLK?: number;
    TOV?: number;
    PF?: number;
  };
}

function getStatColor(value: number, avg: number): string {
  const diff = value - avg;
  if (diff > avg * 0.2) return "text-emerald-400";
  if (diff < -avg * 0.2) return "text-red-400";
  return "";
}

export function RecentGamesTable({ games, seasonAvg }: RecentGamesTableProps) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-medium text-muted-foreground">Date</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">OPP</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-center">W/L</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">MIN</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">PTS</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">REB</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">AST</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">3PM</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">STL</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">BLK</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">TOV</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground text-right">PF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.map((game, idx) => (
            <TableRow key={idx} className="hover-elevate" data-testid={`game-row-${idx}`}>
              <TableCell className="text-xs text-muted-foreground py-2">
                {game.GAME_DATE}
              </TableCell>
              <TableCell className="text-xs font-medium py-2">
                {game.OPPONENT}
              </TableCell>
              <TableCell className="text-center py-2">
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0 ${
                    game.WL === "W" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {game.WL}
                </Badge>
              </TableCell>
              <TableCell className="text-xs font-mono text-right py-2 text-muted-foreground">
                {game.MIN}
              </TableCell>
              <TableCell 
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg ? getStatColor(game.PTS, seasonAvg.PTS) : ""
                }`}
              >
                {game.PTS}
              </TableCell>
              <TableCell 
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg ? getStatColor(game.REB, seasonAvg.REB) : ""
                }`}
              >
                {game.REB}
              </TableCell>
              <TableCell 
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg ? getStatColor(game.AST, seasonAvg.AST) : ""
                }`}
              >
                {game.AST}
              </TableCell>
              <TableCell
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg ? getStatColor(game.FG3M, seasonAvg.FG3M) : ""
                }`}
              >
                {game.FG3M}
              </TableCell>
              <TableCell
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg?.STL ? getStatColor(game.STL ?? 0, seasonAvg.STL) : ""
                }`}
              >
                {game.STL ?? 0}
              </TableCell>
              <TableCell
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg?.BLK ? getStatColor(game.BLK ?? 0, seasonAvg.BLK) : ""
                }`}
              >
                {game.BLK ?? 0}
              </TableCell>
              <TableCell
                className={`text-xs font-mono text-right py-2 font-semibold ${
                  seasonAvg?.TOV ? getStatColor(game.TOV ?? 0, seasonAvg.TOV) : ""
                }`}
              >
                {game.TOV ?? 0}
              </TableCell>
              <TableCell className="text-xs font-mono text-right py-2 text-muted-foreground">
                {game.PF ?? 0}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
