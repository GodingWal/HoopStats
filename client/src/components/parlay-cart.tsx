import { useState } from "react";
import { useParlayCart } from "@/contexts/parlay-cart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingCart, X, TrendingUp, TrendingDown, Send, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

// PrizePicks payout multipliers
const PAYOUT_MULTIPLIERS: Record<number, { flex: number; power: number }> = {
  2: { flex: 3, power: 3 },
  3: { flex: 5, power: 6 },
  4: { flex: 10, power: 12 },
  5: { flex: 20, power: 25 },
  6: { flex: 25, power: 40 },
};

export function ParlayCart() {
  const { picks, removePick, updatePickSide, clearCart } = useParlayCart();
  const [showSubmit, setShowSubmit] = useState(false);
  const [parlayType, setParlayType] = useState<"flex" | "power">("flex");
  const [entryAmount, setEntryAmount] = useState("");

  const numPicks = picks.length;
  const payoutMultiplier = numPicks >= 2 && numPicks <= 6
    ? PAYOUT_MULTIPLIERS[numPicks][parlayType]
    : 0;
  const potentialWin = parseFloat(entryAmount) * payoutMultiplier;

  const submitParlayMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/parlays", {
        parlayType,
        numPicks,
        entryAmount: parseFloat(entryAmount),
        payoutMultiplier,
        picks: picks.map(p => ({
          playerId: 0,
          playerName: p.playerName,
          team: p.team,
          stat: p.statTypeAbbr,
          line: p.line,
          side: p.side,
          gameDate: p.gameDate,
        })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
      clearCart();
      setShowSubmit(false);
      setEntryAmount("");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitParlayMutation.mutateAsync();
  };

  if (picks.length === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5">
        <Card className="premium-card border-primary/50 shadow-2xl shadow-primary/20 w-80">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                Parlay Cart
              </div>
              <Badge variant="outline" className="text-primary border-primary/50">
                {picks.length} {picks.length === 1 ? "pick" : "picks"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-60 overflow-y-auto space-y-2">
              {picks.map((pick, index) => (
                <div key={index} className="p-2 rounded-lg bg-muted/30 border border-border/50">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{pick.playerName}</div>
                      <div className="text-xs text-muted-foreground">
                        {pick.stat} {pick.line}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-400"
                      onClick={() => removePick(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <Select value={pick.side} onValueChange={(v: "over" | "under") => updatePickSide(index, v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="over">
                        <div className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          Over {pick.line}
                        </div>
                      </SelectItem>
                      <SelectItem value="under">
                        <div className="flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" />
                          Under {pick.line}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-border/50 space-y-2">
              {numPicks >= 2 && numPicks <= 6 && (
                <div className="text-xs text-muted-foreground text-center">
                  Flex: {PAYOUT_MULTIPLIERS[numPicks].flex}x • Power: {PAYOUT_MULTIPLIERS[numPicks].power}x
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={clearCart}
                >
                  Clear
                </Button>
                <Button
                  className="flex-1 gap-2"
                  size="sm"
                  onClick={() => setShowSubmit(true)}
                  disabled={numPicks < 2 || numPicks > 6}
                >
                  <Send className="w-4 h-4" />
                  Submit Parlay
                </Button>
              </div>
              {(numPicks < 2 || numPicks > 6) && (
                <div className="text-xs text-amber-500 text-center">
                  Need 2-6 picks to submit
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Submit Parlay</DialogTitle>
            <DialogDescription>
              {numPicks} pick {parlayType} play
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="parlayType">Parlay Type</Label>
              <Select value={parlayType} onValueChange={(v: "flex" | "power") => setParlayType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flex">
                    Flex ({PAYOUT_MULTIPLIERS[numPicks]?.flex}x) - Can miss 1
                  </SelectItem>
                  <SelectItem value="power">
                    Power ({PAYOUT_MULTIPLIERS[numPicks]?.power}x) - All must hit
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="entryAmount">Entry Amount ($)</Label>
              <Input
                id="entryAmount"
                type="number"
                step="0.01"
                value={entryAmount}
                onChange={(e) => setEntryAmount(e.target.value)}
                placeholder="10.00"
                required
              />
            </div>

            {entryAmount && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Payout Multiplier</span>
                  <span className="font-bold">{payoutMultiplier}x</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Potential Win</span>
                  <span className="font-bold text-lg text-emerald-400">
                    ${potentialWin.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">Your Picks:</div>
              {picks.map((pick, i) => (
                <div key={i}>
                  • {pick.playerName} {pick.side.toUpperCase()} {pick.line} {pick.stat}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowSubmit(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitParlayMutation.isPending}>
                {submitParlayMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Submit Parlay
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
