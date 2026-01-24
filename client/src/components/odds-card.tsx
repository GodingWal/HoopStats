import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, Wand2, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PropLine {
    bookmaker: string;
    bookmakerTitle: string;
    over: { price: number; point: number } | null;
    under: { price: number; point: number } | null;
    lastUpdate: string;
}

interface PlayerProp {
    market: string;
    marketLabel: string;
    lines: PropLine[];
}

interface OddsCardProps {
    eventId: string;
    playerName?: string;
    statFilter?: string; // e.g., "player_points"
}

interface OddsStatus {
    configured: boolean;
    remainingRequests?: string;
    usedRequests?: string;
}

interface PlayerPropOdds {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime: string;
    props: PlayerProp[];
}

// Format American odds with + for positive
function formatOdds(price: number): string {
    if (price >= 0) return `+${price}`;
    return `${price}`;
}

// Get color based on odds (positive = green, negative = red hue adjustments)
function getOddsColor(price: number): string {
    if (price >= 100) return "text-green-500";
    if (price >= 0) return "text-green-400";
    if (price >= -150) return "text-amber-400";
    return "text-red-400";
}

// Bookmaker logos/colors
const BOOKMAKER_COLORS: Record<string, string> = {
    draftkings: "bg-emerald-600",
    fanduel: "bg-blue-600",
    betmgm: "bg-amber-600",
    caesars: "bg-purple-600",
    pointsbetus: "bg-red-600",
};

export function OddsCard({ eventId, playerName, statFilter }: OddsCardProps) {
    const { toast } = useToast();
    const [explanation, setExplanation] = useState<string | null>(null);
    const [isExplaining, setIsExplaining] = useState(false);
    const [explainOpen, setExplainOpen] = useState(false);

    // Check if odds API is configured
    const { data: status, isLoading: statusLoading } = useQuery<OddsStatus>({
        queryKey: ["/api/odds/status"],
        staleTime: 1000 * 60 * 5, // 5 min
    });

    // Fetch props for the event
    const { data: propsData, isLoading: propsLoading, error } = useQuery<PlayerPropOdds>({
        queryKey: [`/api/odds/events/${eventId}/props`],
        enabled: !!eventId && status?.configured === true,
        staleTime: 1000 * 60 * 5, // 5 min cache
    });

    if (statusLoading) {
        return <OddsCardSkeleton />;
    }

    if (!status?.configured) {
        return (
            <Card className="border-dashed border-muted-foreground/30">
                <CardContent className="py-6 text-center">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                        Live odds not available
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Add THE_ODDS_API_KEY to enable
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (propsLoading) {
        return <OddsCardSkeleton />;
    }

    if (error || !propsData) {
        return (
            <Card className="border-dashed border-muted-foreground/30">
                <CardContent className="py-6 text-center">
                    <p className="text-sm text-muted-foreground">No odds available</p>
                </CardContent>
            </Card>
        );
    }

    // Filter props if statFilter provided
    const filteredProps = statFilter
        ? propsData.props.filter(p => p.market === statFilter)
        : propsData.props;

    if (filteredProps.length === 0) {
        return (
            <Card className="border-dashed border-muted-foreground/30">
                <CardContent className="py-6 text-center">
                    <p className="text-sm text-muted-foreground">No player props available</p>
                </CardContent>
            </Card>
        );
    }

    const handleExplain = async (propLabel: string, line: number, side: "OVER" | "UNDER") => {
        if (!playerName) return;

        setIsExplaining(true);
        setExplainOpen(true);
        setExplanation(null);

        try {
            const res = await apiRequest("POST", "/api/explain", {
                player_name: playerName,
                prop: propLabel,
                line,
                side,
                // In a real app we'd pass actual stats here, 
                // simplifying for now or relying on backend matching
                season_average: 0,
                last_5_average: 0,
                hit_rate: 0,
                opponent: propsData?.awayTeam === "Unknown" ? "Opponent" : propsData?.awayTeam
            });
            const data = await res.json();
            setExplanation(data.explanation);
        } catch (error) {
            console.error(error);
            setExplanation("Failed to generate explanation. Please try again.");
            toast({
                title: "Error",
                description: "Could not generate analysis",
                variant: "destructive"
            });
        } finally {
            setIsExplaining(false);
        }
    };

    return (
        <div className="space-y-4">
            <Dialog open={explainOpen} onOpenChange={setExplainOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Wand2 className="w-5 h-5 text-purple-500" />
                            Smart Analysis
                        </DialogTitle>
                        <DialogDescription>
                            AI-powered reasoning for this pick based on recent performance and matchup data.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="mt-4">
                        {isExplaining ? (
                            <div className="space-y-3">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-[90%]" />
                                <Skeleton className="h-4 w-[95%]" />
                            </div>
                        ) : (
                            <div className="text-sm leading-relaxed whitespace-pre-line">
                                {explanation}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {filteredProps.map((prop) => (
                <Card key={prop.market} className="premium-card">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <DollarSign className="w-4 h-4 text-primary" />
                                {prop.marketLabel}
                            </CardTitle>
                            <Badge variant="outline" className="text-xs">
                                {prop.lines.length} books
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {prop.lines.slice(0, 5).map((line) => (
                                <div
                                    key={line.bookmaker}
                                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${BOOKMAKER_COLORS[line.bookmaker] || "bg-gray-500"}`} />
                                        <span className="text-sm font-medium">{line.bookmakerTitle}</span>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {/* Over */}
                                        {line.over && (
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 text-sm">
                                                    <TrendingUp className="w-3 h-3 text-green-500" />
                                                    <span className="font-mono text-muted-foreground">O {line.over.point}</span>
                                                    <span className={`font-mono font-bold ${getOddsColor(line.over.price)}`}>
                                                        {formatOdds(line.over.price)}
                                                    </span>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => handleExplain(prop.marketLabel, line.over!.point, "OVER")}
                                                >
                                                    <Wand2 className="w-3 h-3 text-purple-500" />
                                                </Button>
                                            </div>
                                        )}

                                        {/* Separator */}
                                        <span className="text-muted-foreground/30">|</span>

                                        {/* Under */}
                                        {line.under && (
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 text-sm">
                                                    <TrendingDown className="w-3 h-3 text-red-400" />
                                                    <span className="font-mono text-muted-foreground">U {line.under.point}</span>
                                                    <span className={`font-mono font-bold ${getOddsColor(line.under.price)}`}>
                                                        {formatOdds(line.under.price)}
                                                    </span>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => handleExplain(prop.marketLabel, line.under!.point, "UNDER")}
                                                >
                                                    <Wand2 className="w-3 h-3 text-purple-500" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function OddsCardSkeleton() {
    return (
        <Card>
            <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="space-y-2">
                {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                ))}
            </CardContent>
        </Card>
    );
}

// Compact version for player cards
export function OddsBadge({ line, isOver }: { line: number; isOver: boolean }) {
    return (
        <Badge
            variant="outline"
            className={`text-xs font-mono ${isOver ? "border-green-500/30" : "border-red-500/30"}`}
        >
            {isOver ? "O" : "U"} {line}
        </Badge>
    );
}

// Mini odds display for inline use
export function OddsMini({ over, under }: {
    over?: { price: number; point: number };
    under?: { price: number; point: number };
}) {
    if (!over && !under) return null;

    return (
        <div className="flex items-center gap-2 text-xs">
            {over && (
                <span className="font-mono">
                    <span className="text-green-500">O{over.point}</span>
                    <span className={`ml-1 ${getOddsColor(over.price)}`}>{formatOdds(over.price)}</span>
                </span>
            )}
            {over && under && <span className="text-muted-foreground">/</span>}
            {under && (
                <span className="font-mono">
                    <span className="text-red-400">U{under.point}</span>
                    <span className={`ml-1 ${getOddsColor(under.price)}`}>{formatOdds(under.price)}</span>
                </span>
            )}
        </div>
    );
}
