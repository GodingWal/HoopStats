import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OddsCard } from "@/components/odds-card";
import {
    DollarSign,
    Calendar,
    ArrowLeft,
    AlertCircle,
    ExternalLink,
    Clock
} from "lucide-react";
import { format } from "date-fns";

interface OddsEvent {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
}

interface OddsStatus {
    configured: boolean;
    remainingRequests?: string;
    usedRequests?: string;
}

export default function LiveOdds() {
    const [selectedEvent, setSelectedEvent] = useState<OddsEvent | null>(null);

    // Check API status
    const { data: status, isLoading: statusLoading } = useQuery<OddsStatus>({
        queryKey: ["/api/odds/status"],
        staleTime: 1000 * 60 * 5,
    });

    // Fetch events
    const { data: events, isLoading: eventsLoading, error } = useQuery<OddsEvent[]>({
        queryKey: ["/api/odds/events"],
        enabled: status?.configured === true,
        staleTime: 1000 * 60 * 5,
    });

    // Show event detail view
    if (selectedEvent) {
        return (
            <div className="container mx-auto p-6 max-w-5xl fade-in">
                <Button variant="ghost" onClick={() => setSelectedEvent(null)} className="mb-6 hover:bg-primary/10">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Games
                </Button>

                <div className="mb-6">
                    <h1 className="text-2xl font-bold">
                        {selectedEvent.away_team} @ {selectedEvent.home_team}
                    </h1>
                    <p className="text-muted-foreground flex items-center gap-2 mt-1">
                        <Clock className="w-4 h-4" />
                        {format(new Date(selectedEvent.commence_time), "EEEE, MMMM d 'at' h:mm a")}
                    </p>
                </div>

                <OddsCard eventId={selectedEvent.id} />
            </div>
        );
    }

    if (statusLoading || eventsLoading) {
        return (
            <div className="container mx-auto p-6 max-w-5xl">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-xl bg-primary/10">
                        <DollarSign className="w-7 h-7 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Live Odds</h1>
                        <p className="text-muted-foreground">Loading betting lines...</p>
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {[1, 2, 3, 4].map((i) => (
                        <Card key={i}>
                            <CardContent className="p-4">
                                <Skeleton className="h-16 w-full" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    if (!status?.configured) {
        return (
            <div className="container mx-auto p-6 max-w-5xl fade-in">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-xl bg-primary/10">
                        <DollarSign className="w-7 h-7 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Live Odds</h1>
                        <p className="text-muted-foreground">Real betting lines from major sportsbooks</p>
                    </div>
                </div>

                <Card className="max-w-lg mx-auto mt-12">
                    <CardContent className="py-8 text-center">
                        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-amber-500" />
                        <h2 className="text-xl font-semibold mb-2">API Key Required</h2>
                        <p className="text-muted-foreground mb-4">
                            To display live betting odds, you need to configure The Odds API.
                        </p>
                        <ol className="text-left text-sm space-y-2 mb-6 max-w-xs mx-auto">
                            <li className="flex items-start gap-2">
                                <span className="font-bold text-primary">1.</span>
                                <span>Get a free API key at <a href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">the-odds-api.com</a></span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-bold text-primary">2.</span>
                                <span>Create a <code className="bg-muted px-1 rounded">.env</code> file in your project root</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-bold text-primary">3.</span>
                                <span>Add: <code className="bg-muted px-1 rounded">THE_ODDS_API_KEY=your_key</code></span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-bold text-primary">4.</span>
                                <span>Restart the server</span>
                            </li>
                        </ol>
                        <Button asChild>
                            <a href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Get Free API Key
                            </a>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto p-6 max-w-5xl fade-in">
                <div className="text-center py-12">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
                    <h2 className="text-xl font-semibold">Error Loading Odds</h2>
                    <p className="text-muted-foreground mt-2">Please try again later</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-5xl fade-in">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-primary/10">
                    <DollarSign className="w-7 h-7 text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold tracking-tight">Live Odds</h1>
                    <p className="text-muted-foreground">Real betting lines from DraftKings, FanDuel, BetMGM & more</p>
                </div>
                {status?.remainingRequests && (
                    <Badge variant="outline" className="text-xs">
                        {status.remainingRequests} API calls remaining
                    </Badge>
                )}
            </div>

            {/* Events Grid */}
            {!events || events.length === 0 ? (
                <div className="text-center py-16">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <h2 className="text-xl font-semibold">No Games Today</h2>
                    <p className="text-muted-foreground mt-2">Check back when there are NBA games scheduled</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {events.map((event) => (
                        <Card
                            key={event.id}
                            className="premium-card cursor-pointer transition-all hover:border-primary/30"
                            onClick={() => setSelectedEvent(event)}
                        >
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <Badge variant="outline" className="text-xs">
                                        {format(new Date(event.commence_time), "h:mm a")}
                                    </Badge>
                                    <Badge className="bg-primary/10 text-primary border-0 text-xs">
                                        View Odds →
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <p className="font-medium">{event.away_team}</p>
                                        <p className="font-medium">{event.home_team}</p>
                                    </div>
                                    <div className="text-right text-sm text-muted-foreground">
                                        <p>@</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
