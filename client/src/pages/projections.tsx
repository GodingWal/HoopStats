
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Loader2, Search, BrainCircuit, Sparkles, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface ProjectionStats {
    mean: number;
    std: number;
}

interface PlayerProjection {
    points: ProjectionStats;
    rebounds: ProjectionStats;
    assists: ProjectionStats;
    threes: ProjectionStats;
    pts_reb_ast: ProjectionStats;
    minutes: ProjectionStats;
    error?: string;
}

interface ProjectionsResponse {
    [playerName: string]: PlayerProjection | { error: string };
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

                        const proj = data as PlayerProjection;
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
                                        <StatCard
                                            label="Points"
                                            mean={proj.points.mean}
                                            std={proj.points.std}
                                            highlight
                                        />
                                        <StatCard
                                            label="Rebounds"
                                            mean={proj.rebounds.mean}
                                            std={proj.rebounds.std}
                                        />
                                        <StatCard
                                            label="Assists"
                                            mean={proj.assists.mean}
                                            std={proj.assists.std}
                                        />
                                        <StatCard
                                            label="3-Pointers"
                                            mean={proj.threes.mean}
                                            std={proj.threes.std}
                                        />
                                        <StatCard
                                            label="PRA"
                                            mean={proj.pts_reb_ast.mean}
                                            std={proj.pts_reb_ast.std}
                                            highlight
                                        />
                                        <StatCard
                                            label="Minutes"
                                            mean={proj.minutes.mean}
                                            std={proj.minutes.std}
                                            dimmed
                                        />
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
