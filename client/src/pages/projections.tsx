
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Loader2, Search, BrainCircuit, Sparkles, TrendingUp, TrendingDown, User, Calendar, Activity, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface ProjectionStats {
    mean: number;
    std: number;
}

interface Averages {
    games: number;
    pts: number;
    reb: number;
    ast: number;
    fg3m: number;
    min: number;
    stl: number;
    blk: number;
    tov: number;
    fgPct: number;
    fg3Pct: number;
}

interface RecentGame {
    date: string;
    opponent: string;
    result: string;
    pts: number;
    reb: number;
    ast: number;
    fg3m: number;
    min: number;
}

interface PlayerInfo {
    team?: string;
    teamName?: string;
    position?: string;
    height?: string;
    weight?: string;
    jersey?: string;
}

interface ModelContext {
    gamesAnalyzed: number;
    opponent: string;
    isHome: boolean;
    isB2B: boolean;
    restDays: number;
    opponentDefRating: number;
    opponentPace: number;
    isRealData?: boolean;
}

interface PlayerProjection {
    projection: {
        points: ProjectionStats;
        rebounds: ProjectionStats;
        assists: ProjectionStats;
        threes: ProjectionStats;
        pts_reb_ast: ProjectionStats;
        minutes: ProjectionStats;
    };
    playerInfo: PlayerInfo;
    seasonAverages: Averages;
    last5Averages: Averages;
    last10Averages: Averages;
    recentGames: RecentGame[];
    modelContext: ModelContext;
    error?: string;
}

// Legacy format support
interface LegacyProjection {
    points: ProjectionStats;
    rebounds: ProjectionStats;
    assists: ProjectionStats;
    threes: ProjectionStats;
    pts_reb_ast: ProjectionStats;
    minutes: ProjectionStats;
    error?: string;
}

interface ProjectionsResponse {
    [playerName: string]: PlayerProjection | LegacyProjection | { error: string };
}

function isNewFormat(data: PlayerProjection | LegacyProjection | { error: string }): data is PlayerProjection {
    return 'projection' in data;
}

export default function ProjectionsPage() {
    const [playerInput, setPlayerInput] = useState("");
    const { toast } = useToast();

    const mutation = useMutation({
        mutationFn: async (players: string[]) => {
            const res = await apiRequest("POST", "/api/projections", { players });
            return res.json() as Promise<ProjectionsResponse>;
        },
        onError: (error: Error) => {
            toast({
                title: "Failed to generate projections",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleGenerate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!playerInput.trim()) return;

        const players = playerInput.split(",").map((p) => p.trim()).filter((p) => p);
        mutation.mutate(players);
    };

    const projections = mutation.data;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 fade-in">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-primary/20">
                    <BrainCircuit className="w-7 h-7 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">AI Projections</h1>
                    <p className="text-muted-foreground">
                        Generate detailed stat projections using our advanced Python model
                    </p>
                </div>
            </div>

            <Card className="premium-card rounded-xl overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Generate Projections
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                    <form onSubmit={handleGenerate} className="flex gap-4">
                        <div className="flex-1 relative">
                            <Input
                                placeholder="e.g. LeBron James, Luka Doncic, Jayson Tatum"
                                value={playerInput}
                                onChange={(e) => setPlayerInput(e.target.value)}
                                disabled={mutation.isPending}
                                className="bg-muted/50 border-muted focus:border-primary/50 transition-colors"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={mutation.isPending || !playerInput.trim()}
                            className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 transition-all"
                        >
                            {mutation.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Search className="mr-2 h-4 w-4" />
                                    Generate
                                </>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {projections && (
                <div className="grid gap-6 stagger-fade">
                    {Object.entries(projections).map(([player, data]) => {
                        if ('error' in data && data.error) {
                            return (
                                <Card key={player} className="rounded-xl border-red-500/30 bg-red-500/5">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-red-400">
                                            <AlertCircle className="h-5 w-5" />
                                            {player}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-muted-foreground">{data.error}</p>
                                    </CardContent>
                                </Card>
                            )
                        }

                        // Handle new enriched format
                        if (isNewFormat(data)) {
                            return <EnrichedPlayerCard key={player} player={player} data={data} />;
                        }

                        // Legacy format fallback
                        const proj = data as LegacyProjection;
                        return (
                            <Card key={player} className="premium-card rounded-xl overflow-hidden">
                                <CardHeader className="bg-gradient-to-r from-card via-card to-accent/20">
                                    <CardTitle className="flex items-center justify-between">
                                        <span className="text-xl">{player}</span>
                                        <Badge className="bg-primary/10 text-primary border-primary/20">
                                            <TrendingUp className="w-3 h-3 mr-1" />
                                            AI Projection
                                        </Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                        <StatCard label="Points" mean={proj.points.mean} std={proj.points.std} highlight />
                                        <StatCard label="Rebounds" mean={proj.rebounds.mean} std={proj.rebounds.std} />
                                        <StatCard label="Assists" mean={proj.assists.mean} std={proj.assists.std} />
                                        <StatCard label="3-Pointers" mean={proj.threes.mean} std={proj.threes.std} />
                                        <StatCard label="PRA" mean={proj.pts_reb_ast.mean} std={proj.pts_reb_ast.std} highlight />
                                        <StatCard label="Minutes" mean={proj.minutes.mean} std={proj.minutes.std} dimmed />
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {!projections && !mutation.isPending && (
                <div className="text-center py-16">
                    <div className="relative w-20 h-20 mx-auto mb-6">
                        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 animate-pulse" />
                        <BrainCircuit className="w-10 h-10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/60" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Ready to Generate</h3>
                    <p className="text-muted-foreground max-w-md mx-auto">
                        Enter player names above to get AI-powered statistical projections with confidence intervals
                    </p>
                </div>
            )}
        </div>
    );
}

function EnrichedPlayerCard({ player, data }: { player: string; data: PlayerProjection }) {
    const proj = data.projection;
    const info = data.playerInfo;
    const season = data.seasonAverages;
    const last5 = data.last5Averages;
    const last10 = data.last10Averages;
    const games = data.recentGames;
    const context = data.modelContext;

    return (
        <Card className="premium-card rounded-xl overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-card via-card to-accent/20">
                <CardTitle className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                            {info?.jersey || '#'}
                        </div>
                        <div>
                            <span className="text-xl">{player}</span>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                {info?.team && <span>{info.team}</span>}
                                {info?.position && <span>• {info.position}</span>}
                                {info?.height && <span>• {info.height}</span>}
                            </div>
                        </div>
                    </div>
                    <Badge className="bg-primary/10 text-primary border-primary/20">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        AI Projection
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
                {/* Projected Stats */}
                <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Projected Stats (Tonight)
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <StatCard label="Points" mean={proj.points.mean} std={proj.points.std} highlight />
                        <StatCard label="Rebounds" mean={proj.rebounds.mean} std={proj.rebounds.std} />
                        <StatCard label="Assists" mean={proj.assists.mean} std={proj.assists.std} />
                        <StatCard label="3-Pointers" mean={proj.threes.mean} std={proj.threes.std} />
                        <StatCard label="PRA" mean={proj.pts_reb_ast.mean} std={proj.pts_reb_ast.std} highlight />
                        <StatCard label="Minutes" mean={proj.minutes.mean} std={proj.minutes.std} dimmed />
                    </div>
                </div>

                {/* PrizePicks Lines */}
                <PrizePicksLines playerName={player} projection={proj} />

                {/* Season & Recent Averages Comparison */}
                {season && (
                    <div>
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4" />
                            Averages Comparison
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border/50">
                                        <th className="text-left py-2 text-muted-foreground font-medium">Split</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">GP</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">PTS</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">REB</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">AST</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">3PM</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">STL</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">BLK</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">TOV</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">MIN</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">FG%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b border-border/30">
                                        <td className="py-2 font-medium">Season</td>
                                        <td className="text-center py-2">{season.games}</td>
                                        <td className="text-center py-2 font-mono">{season.pts}</td>
                                        <td className="text-center py-2 font-mono">{season.reb}</td>
                                        <td className="text-center py-2 font-mono">{season.ast}</td>
                                        <td className="text-center py-2 font-mono">{season.fg3m}</td>
                                        <td className="text-center py-2 font-mono">{season.stl}</td>
                                        <td className="text-center py-2 font-mono">{season.blk}</td>
                                        <td className="text-center py-2 font-mono">{season.tov}</td>
                                        <td className="text-center py-2 font-mono">{season.min}</td>
                                        <td className="text-center py-2 font-mono">{season.fgPct}%</td>
                                    </tr>
                                    {last10 && (
                                        <tr className="border-b border-border/30">
                                            <td className="py-2 font-medium">Last 10</td>
                                            <td className="text-center py-2">{last10.games}</td>
                                            <td className="text-center py-2 font-mono">{last10.pts}</td>
                                            <td className="text-center py-2 font-mono">{last10.reb}</td>
                                            <td className="text-center py-2 font-mono">{last10.ast}</td>
                                            <td className="text-center py-2 font-mono">{last10.fg3m}</td>
                                            <td className="text-center py-2 font-mono">{last10.stl}</td>
                                            <td className="text-center py-2 font-mono">{last10.blk}</td>
                                            <td className="text-center py-2 font-mono">{last10.tov}</td>
                                            <td className="text-center py-2 font-mono">{last10.min}</td>
                                            <td className="text-center py-2 font-mono">{last10.fgPct}%</td>
                                        </tr>
                                    )}
                                    {last5 && (
                                        <tr className="bg-primary/5">
                                            <td className="py-2 font-medium text-primary">Last 5</td>
                                            <td className="text-center py-2">{last5.games}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.pts}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.reb}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.ast}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.fg3m}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.stl}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.blk}</td>
                                            <td className="text-center py-2 font-mono font-bold">{last5.tov}</td>
                                            <td className="text-center py-2 font-mono">{last5.min}</td>
                                            <td className="text-center py-2 font-mono">{last5.fgPct}%</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Recent Games */}
                {games && games.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            Recent Games
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border/50">
                                        <th className="text-left py-2 text-muted-foreground font-medium">Date</th>
                                        <th className="text-left py-2 text-muted-foreground font-medium">OPP</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">W/L</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">PTS</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">REB</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">AST</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">3PM</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">STL</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">BLK</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">TOV</th>
                                        <th className="text-center py-2 text-muted-foreground font-medium">MIN</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {games.map((game, i) => (
                                        <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                                            <td className="py-2">{game.date}</td>
                                            <td className="py-2 font-medium">{game.opponent}</td>
                                            <td className="text-center py-2">
                                                <Badge className={game.result === 'W' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}>
                                                    {game.result}
                                                </Badge>
                                            </td>
                                            <td className="text-center py-2 font-mono font-bold">{game.pts}</td>
                                            <td className="text-center py-2 font-mono">{game.reb}</td>
                                            <td className="text-center py-2 font-mono">{game.ast}</td>
                                            <td className="text-center py-2 font-mono">{game.fg3m}</td>
                                            <td className="text-center py-2 font-mono">{game.stl ?? 0}</td>
                                            <td className="text-center py-2 font-mono">{game.blk ?? 0}</td>
                                            <td className="text-center py-2 font-mono">{game.tov ?? 0}</td>
                                            <td className="text-center py-2 font-mono text-muted-foreground">{game.min}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Model Context */}
                {context && (
                    <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            Model Context
                            {context.isRealData ? (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">Live Data</Badge>
                            ) : (
                                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">No Game Today</Badge>
                            )}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                                <span className="text-muted-foreground">Games Analyzed:</span>
                                <span className="ml-2 font-mono font-bold">{context.gamesAnalyzed}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Opponent:</span>
                                <span className="ml-2 font-mono font-bold">{context.opponent}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Location:</span>
                                <span className="ml-2 font-mono">{context.isHome ? 'Home' : 'Away'}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Back-to-Back:</span>
                                <span className={`ml-2 font-mono ${context.isB2B ? 'text-amber-400' : ''}`}>
                                    {context.isB2B ? 'Yes' : 'No'}
                                </span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Rest Days:</span>
                                <span className="ml-2 font-mono">{context.restDays}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Opp Def Rating:</span>
                                <span className="ml-2 font-mono">{context.opponentDefRating?.toFixed(1) || 'N/A'}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Opp Pace:</span>
                                <span className="ml-2 font-mono">{context.opponentPace?.toFixed(1) || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function StatCard({ label, mean, std, highlight = false, dimmed = false }: {
    label: string;
    mean: number;
    std: number;
    highlight?: boolean;
    dimmed?: boolean;
}) {
    return (
        <div className={`p-4 rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-lg ${highlight
            ? 'bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 hover:border-primary/40'
            : dimmed
                ? 'bg-muted/30 border-border/50'
                : 'bg-muted/50 border-border/50 hover:border-primary/30'
            }`}>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
            <div className={`text-2xl font-bold font-mono ${highlight ? 'stat-gradient' : dimmed ? 'text-muted-foreground' : 'text-foreground'}`}>
                {mean.toFixed(1)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">±{std.toFixed(1)}</div>
        </div>
    );
}

interface PrizePicksProp {
    id: string;
    statType: string;
    statTypeAbbr: string;
    line: number;
    gameTime: string;
}

function PrizePicksLines({ playerName, projection }: {
    playerName: string;
    projection: { points: ProjectionStats; rebounds: ProjectionStats; assists: ProjectionStats; threes: ProjectionStats; pts_reb_ast: ProjectionStats; }
}) {
    const [props, setProps] = useState<PrizePicksProp[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch PrizePicks lines for this player on mount
    useEffect(() => {
        setLoading(true);
        fetch(`/api/prizepicks/player/${encodeURIComponent(playerName)}`)
            .then(res => res.json())
            .then(data => {
                setProps(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch(() => {
                setProps([]);
                setLoading(false);
            });
    }, [playerName]); // Only refetch when player name changes

    const getProjectedValue = (statType: string, statAbbr: string): number | null => {
        const key = (statType || statAbbr || '').toLowerCase();

        // Map various PrizePicks stat names to our projections
        if (key.includes('point') || statAbbr === 'PTS') return projection.points.mean;
        if (key.includes('rebound') || statAbbr === 'REB') return projection.rebounds.mean;
        if (key.includes('assist') || statAbbr === 'AST') return projection.assists.mean;
        if (key.includes('3-pt') || key.includes('three') || key.includes('3-pointer') || statAbbr === 'FG3M') return projection.threes.mean;
        if (key.includes('pts+reb+ast') || key.includes('pra') || statAbbr === 'PRA') return projection.pts_reb_ast.mean;

        return null;
    };

    if (loading) {
        return (
            <div className="p-3 bg-muted/20 rounded-lg border border-border/50">
                <div className="text-xs text-muted-foreground">Loading PrizePicks lines...</div>
            </div>
        );
    }

    if (props.length === 0) {
        return (
            <div className="p-3 bg-muted/20 rounded-lg border border-border/50">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <img src="https://prizepicks.com/favicon.ico" alt="PP" className="w-3 h-3" onError={(e) => e.currentTarget.style.display = 'none'} />
                    No PrizePicks lines available for {playerName}
                </div>
            </div>
        );
    }

    return (
        <div className="p-3 bg-muted/20 rounded-lg border border-border/50">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                <img src="https://prizepicks.com/favicon.ico" alt="PP" className="w-3 h-3" onError={(e) => e.currentTarget.style.display = 'none'} />
                PrizePicks Lines
            </h4>
            <div className="flex flex-wrap gap-2">
                {props.slice(0, 6).map((prop) => {
                    const projected = getProjectedValue(prop.statType, prop.statTypeAbbr);
                    const edge = projected ? projected - prop.line : null;
                    const isOver = edge && edge > 0;

                    return (
                        <div
                            key={prop.id}
                            className={`px-2 py-1 rounded text-xs flex items-center gap-1.5 ${edge && Math.abs(edge) >= 1
                                ? isOver ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-rose-500/10 border border-rose-500/30'
                                : 'bg-muted/50 border border-border/50'
                                }`}
                        >
                            <span className="text-muted-foreground">{prop.statType}:</span>
                            <span className="font-mono font-bold">{prop.line}</span>
                            {edge && Math.abs(edge) >= 0.5 && (
                                <span className={`font-mono text-[10px] ${isOver ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    ({isOver ? '+' : ''}{edge.toFixed(1)})
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

