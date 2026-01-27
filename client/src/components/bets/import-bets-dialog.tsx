/**
 * ImportBetsDialog component - dialog for importing PrizePicks bets
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, AlertCircle } from "lucide-react";
import { useParlayCart } from "@/contexts/parlay-cart";
import { parsePrizePicksLog } from "./utils";

interface ImportBetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportBetsDialog({ open, onOpenChange }: ImportBetsDialogProps) {
  const [logText, setLogText] = useState("");
  const [parsedPicks, setParsedPicks] = useState<ReturnType<typeof parsePrizePicksLog>>([]);
  const [error, setError] = useState<string | null>(null);
  const { addMultiplePicks } = useParlayCart();

  const handleParse = () => {
    try {
      const picks = parsePrizePicksLog(logText);
      if (picks.length === 0) {
        setError("Couldn't parse any bets. Make sure the format is correct.");
      } else {
        setParsedPicks(picks);
        setError(null);
      }
    } catch (e) {
      setError("Failed to parse transaction log. Check the format.");
    }
  };

  const handleImport = () => {
    const today = new Date().toISOString().split('T')[0];
    const cartPicks = parsedPicks.map(pick => ({
      playerId: pick.playerName.toLowerCase().replace(/\s+/g, '-'),
      playerName: pick.playerName,
      team: "",
      stat: pick.stat,
      statTypeAbbr: pick.statAbbr,
      line: pick.line,
      gameDate: today,
    }));

    addMultiplePicks(cartPicks);
    setLogText("");
    setParsedPicks([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import PrizePicks Bets</DialogTitle>
          <DialogDescription>
            Paste your PrizePicks transaction log to import bets
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="log-text">Transaction Log</Label>
            <textarea
              id="log-text"
              className="w-full h-40 p-3 mt-1 rounded-lg border bg-background text-sm font-mono resize-none"
              placeholder={`Peyton Watson\nMore than 23.5 Points\nAl Horford\nMore than 10.5 Rebs+Asts\n...`}
              value={logText}
              onChange={(e) => {
                setLogText(e.target.value);
                setParsedPicks([]);
                setError(null);
              }}
            />
          </div>

          {error && (
            <div className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {parsedPicks.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">
                Found {parsedPicks.length} bets:
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {parsedPicks.map((pick, i) => (
                  <div key={i} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                    <span className="font-medium">{pick.playerName}</span>
                    <span className={pick.side === "over" ? "text-emerald-500" : "text-rose-500"}>
                      {pick.side === "over" ? "O" : "U"} {pick.line} {pick.statAbbr}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {parsedPicks.length > 0 ? (
            <Button onClick={handleImport}>
              <Plus className="w-4 h-4 mr-2" />
              Import {parsedPicks.length} Bets
            </Button>
          ) : (
            <Button onClick={handleParse} disabled={!logText.trim()}>
              Parse Bets
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
