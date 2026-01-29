import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, DollarSign, Target, Trophy, Loader2, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp, Plus, AlertCircle, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ParlayPick {
  id: number;
  parlayId: number;
  playerId?: number;
  playerName: string;
  team: string;
  stat: string;
  line: number;
  side: "over" | "under";
  gameDate: string;
  result?: "hit" | "miss" | "push" | "pending";
  actualValue?: number;
}

interface Parlay {
  id: number;
  parlayType: "flex" | "power";
  numPicks: number;
  entryAmount: number;
  payoutMultiplier: number;
  result?: "win" | "loss" | "push" | "pending";
  profit?: number;
  placedAt: string;
  settledAt?: string;
  notes?: string;
  picks: ParlayPick[];
}

// Parse PrizePicks transaction log text format
function parsePrizePicksLog(text: string): Array<{
  playerName: string;
  line: number;
  stat: string;
  statAbbr: string;
  side: "over" | "under";
}> {
  const lines = text.trim().split('\n').filter(line => line.trim());
  const picks: Array<{
    playerName: string;
    line: number;
    stat: string;
    statAbbr: string;
    side: "over" | "under";
  }> = [];

  const statMapping: Record<string, string> = {
    "points": "PTS",
    "rebounds": "REB",
    "assists": "AST",
    "pts+rebs+asts": "PRA",
    "pts+rebs": "PR",
    "pts+asts": "PA",
    "rebs+asts": "RA",
    "3-pointers made": "FG3M",
    "3-pointers": "FG3M",
    "steals": "STL",
    "blocks": "BLK",
    "turnovers": "TO",
    "fantasy score": "FPTS",
  };

  for (let i = 0; i < lines.length - 1; i += 2) {
    const playerName = lines[i].trim();
    const betLine = lines[i + 1]?.trim().toLowerCase() || "";

    const moreMatch = betLine.match(/more than\s+([\d.]+)\s+(.+)/);
    const lessMatch = betLine.match(/less than\s+([\d.]+)\s+(.+)/);

    const match = moreMatch || lessMatch;
    if (match) {
      const lineValue = parseFloat(match[1]);
      const statText = match[2].trim();
      const side: "over" | "under" = moreMatch ? "over" : "under";
      const statAbbr = statMapping[statText] || statText.toUpperCase().replace(/\s+/g, "");

      picks.push({
        playerName,
        line: lineValue,
        stat: statText,
        statAbbr,
        side,
      });
    }
  }

  return picks;
}

// Import dialog component
function ImportBetsDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (picks: Array<{ playerName: string; line: number; stat: string; statAbbr: string; side: "over" | "under" }>) => void;
}) {
  const [logText, setLogText] = useState("");
  const [parsedPicks, setParsedPicks] = useState<ReturnType<typeof parsePrizePicksLog>>([]);
  const [error, setError] = useState<string | null>(null);

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
    onImport(parsedPicks);
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
            Paste your PrizePicks transaction log to create a parlay
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
              Create Parlay ({parsedPicks.length} picks)
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

function StatCard({ title, value, icon: Icon, color, subtitle }: { title: string; value: string | number; icon: any; color: string; subtitle?: string }) {
  return (
    <Card className="premium-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function PickRow({ pick }: { pick: ParlayPick }) {
  const isOver = pick.side === "over";
  const pickResult = pick.result || "pending";
  const hasActual = pick.actualValue !== undefined && pick.actualValue !== null;

  return (
    <div
      className={`p-3 rounded-lg border text-sm ${pickResult === "hit"
        ? "bg-emerald-500/10 border-emerald-500/30"
        : pickResult === "miss"
          ? "bg-rose-500/10 border-rose-500/30"
          : pickResult === "push"
            ? "bg-yellow-500/10 border-yellow-500/30"
            : "bg-muted/30 border-border/50"
        }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{pick.playerName}</div>
          <div className="text-xs text-muted-foreground">
            {pick.team && `${pick.team} • `}{pick.stat}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${isOver ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"}`}>
            {isOver ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {pick.side.toUpperCase()} {pick.line}
          </div>
          {hasActual && (
            <div className="font-mono text-xs font-bold px-2 py-1 rounded bg-muted/50">
              {pick.actualValue}
            </div>
          )}
          {pickResult !== "pending" ? (
            <Badge
              variant="outline"
              className={`text-xs ${pickResult === "hit"
                ? "border-emerald-500/50 text-emerald-400"
                : pickResult === "miss"
                  ? "border-rose-500/50 text-rose-400"
                  : "border-yellow-500/50 text-yellow-400"
                }`}
            >
              {pickResult === "hit" ? (
                <CheckCircle className="w-3 h-3 mr-1" />
              ) : pickResult === "miss" ? (
                <XCircle className="w-3 h-3 mr-1" />
              ) : (
                <MinusCircle className="w-3 h-3 mr-1" />
              )}
              {pickResult.toUpperCase()}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground border-border/50">
              PENDING
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function ParlayCard({ parlay }: { parlay: Parlay }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isPending = !parlay.result || parlay.result === "pending";

  const placedDate = new Date(parlay.placedAt);
  const formattedDate = placedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const formattedTime = placedDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const potentialWin = parlay.entryAmount * parlay.payoutMultiplier;
  const hitsNeeded = parlay.parlayType === "flex" ? parlay.numPicks - 1 : parlay.numPicks;
  const currentHits = parlay.picks.filter(p => p.result === "hit").length;
  const settledCount = parlay.picks.filter(p => p.result && p.result !== "pending").length;

  return (
    <Card className={`premium-card ${isPending ? 'border-primary/30' : parlay.result === 'win' ? 'border-emerald-500/30' : parlay.result === 'loss' ? 'border-rose-500/30' : 'border-yellow-500/30'}`}>
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
                  {parlay.numPicks}-Pick {parlay.parlayType.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {parlay.payoutMultiplier}x
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formattedDate} at {formattedTime}
                </span>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Entry:</span>
                  <span className="font-mono font-bold ml-2">${parlay.entryAmount.toFixed(2)}</span>
                </div>
                <div className="text-muted-foreground">|</div>
                <div>
                  <span className="text-muted-foreground">To Win:</span>
                  <span className="font-mono font-bold ml-2 text-emerald-400">${potentialWin.toFixed(2)}</span>
                </div>
              </div>

              {!isPending && (
                <div className="text-sm">
                  <span className="text-muted-foreground">P&L:</span>
                  <span className={`font-bold ml-2 ${parlay.profit! > 0 ? 'text-emerald-400' : parlay.profit! < 0 ? 'text-rose-400' : 'text-muted-foreground'}`}>
                    {parlay.profit! > 0 ? '+' : ''}{parlay.profit?.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2 min-w-[100px]">
              {isPending ? (
                <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-500/30 bg-yellow-500/10">
                  {settledCount}/{parlay.numPicks} SETTLED
                </Badge>
              ) : (
                <Badge className={`${parlay.result === 'win' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : parlay.result === 'loss' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'}`}>
                  {parlay.result?.toUpperCase()}
                </Badge>
              )}
            </div>
          </div>

          {/* Picks - individual line tracking */}
          <div className="pt-2 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between hover:bg-muted/50"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <span className="text-sm font-medium">
                {parlay.numPicks} Picks {isPending && `(${currentHits} hits / ${hitsNeeded} needed)`}
              </span>
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>

            {isExpanded && (
              <div className="mt-3 space-y-2">
                {parlay.picks.map((pick) => (
                  <PickRow key={pick.id} pick={pick} />
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyBets() {
  const [filter, setFilter] = useState<"all" | "pending" | "settled">("all");
  const [showImportDialog, setShowImportDialog] = useState(false);

  const { data: parlays, isLoading } = useQuery<Parlay[]>({
    queryKey: ["/api/parlays"],
    refetchInterval: 60000, // Auto-refresh every minute to pick up settlements
  });

  const settleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settle");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
    },
  });

  const createParlayMutation = useMutation({
    mutationFn: async (parlayData: {
      parlayType: "flex" | "power";
      numPicks: number;
      entryAmount: number;
      payoutMultiplier: number;
      picks: Array<{ playerName: string; team: string; stat: string; line: number; side: "over" | "under"; gameDate: string }>;
    }) => {
      const res = await apiRequest("POST", "/api/parlays", parlayData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
    },
  });

  const handleImportPicks = async (picks: Array<{ playerName: string; line: number; stat: string; statAbbr: string; side: "over" | "under" }>) => {
    const today = new Date().toISOString().split('T')[0];

    // Calculate payout multiplier based on number of picks (typical PrizePicks payouts)
    const payoutMultipliers: Record<number, number> = {
      2: 3,
      3: 5,
      4: 10,
      5: 20,
      6: 25,
    };

    const numPicks = picks.length;
    const payoutMultiplier = payoutMultipliers[numPicks] || numPicks * 3;

    const parlayData = {
      parlayType: "flex" as const,
      numPicks,
      entryAmount: 10, // Default entry amount
      payoutMultiplier,
      picks: picks.map(pick => ({
        playerName: pick.playerName,
        team: "",
        stat: pick.statAbbr,
        line: pick.line,
        side: pick.side,
        gameDate: today,
      })),
    };

    await createParlayMutation.mutateAsync(parlayData);
  };

  const filteredParlays = useMemo(() => {
    if (!parlays) return [];
    if (filter === "pending") return parlays.filter(p => !p.result || p.result === "pending");
    if (filter === "settled") return parlays.filter(p => p.result && p.result !== "pending");
    return parlays;
  }, [parlays, filter]);

  const stats = useMemo(() => {
    if (!parlays) return { totalParlays: 0, pendingParlays: 0, totalProfit: 0, winRate: 0, roi: 0, totalPicks: 0, hitsCount: 0 };

    const settled = parlays.filter(p => p.result && p.result !== "pending");
    const wins = settled.filter(p => p.result === "win").length;
    const totalProfit = settled.reduce((sum, p) => sum + (p.profit || 0), 0);
    const totalRisked = settled.reduce((sum, p) => sum + p.entryAmount, 0);

    const allPicks = parlays.flatMap(p => p.picks);
    const hitsCount = allPicks.filter(p => p.result === "hit").length;

    return {
      totalParlays: parlays.length,
      pendingParlays: parlays.filter(p => !p.result || p.result === "pending").length,
      totalProfit,
      winRate: settled.length > 0 ? (wins / settled.length) * 100 : 0,
      roi: totalRisked > 0 ? (totalProfit / totalRisked) * 100 : 0,
      totalPicks: allPicks.length,
      hitsCount,
    };
  }, [parlays]);

  const pendingPickCount = useMemo(() => {
    if (!parlays) return 0;
    return parlays.flatMap(p => p.picks).filter(p => !p.result || p.result === "pending").length;
  }, [parlays]);

  return (
    <div className="min-h-screen bg-background">
      <ImportBetsDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImport={handleImportPicks}
      />
      <div className="container mx-auto px-4 py-8 max-w-6xl fade-in">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Trophy className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">My Bets</h1>
              <p className="text-muted-foreground">Each line tracked & settled automatically</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingPickCount > 0 && (
              <Button
                variant="outline"
                onClick={() => settleMutation.mutate()}
                disabled={settleMutation.isPending}
                className="hover:border-emerald-500/50"
              >
                {settleMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Settle Now
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setShowImportDialog(true)}
              className="hover:border-primary/50"
            >
              <Plus className="w-4 h-4 mr-2" />
              Import Bets
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard
            title="Total Parlays"
            value={stats.totalParlays}
            icon={Target}
            color="text-primary"
          />
          <StatCard
            title="Pending"
            value={stats.pendingParlays}
            icon={Target}
            color="text-yellow-400"
            subtitle={`${pendingPickCount} picks unsettled`}
          />
          <StatCard
            title="Pick Hit Rate"
            value={stats.totalPicks > 0 ? `${((stats.hitsCount / stats.totalPicks) * 100).toFixed(1)}%` : "—"}
            icon={Trophy}
            color="text-emerald-400"
            subtitle={`${stats.hitsCount}/${stats.totalPicks} picks`}
          />
          <StatCard
            title="Total P&L"
            value={`$${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(2)}`}
            icon={DollarSign}
            color={stats.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400"}
          />
          <StatCard
            title="ROI"
            value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`}
            icon={TrendingUp}
            color={stats.roi >= 0 ? "text-emerald-400" : "text-rose-400"}
          />
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as "all" | "pending" | "settled")} className="mb-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="settled">Settled</TabsTrigger>
          </TabsList>
        </Tabs>

        {settleMutation.isSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
            <CheckCircle className="w-4 h-4 inline mr-2" />
            Settlement complete — {(settleMutation.data as any)?.message || "picks updated"}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Loading your bets...</span>
          </div>
        ) : filteredParlays.length > 0 ? (
          <div className="space-y-3">
            {filteredParlays.map((parlay) => (
              <ParlayCard
                key={parlay.id}
                parlay={parlay}
              />
            ))}
          </div>
        ) : (
          <Card className="rounded-xl border-border/50">
            <CardContent className="py-16 text-center">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 animate-pulse" />
                <Target className="w-10 h-10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/60" />
              </div>
              <h3 className="text-xl font-bold mb-2">No Bets Yet</h3>
              <p className="text-muted-foreground mb-4">
                {filter === "pending" ? "No pending bets" : filter === "settled" ? "No settled bets" : "Import your PrizePicks bets to start tracking"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
