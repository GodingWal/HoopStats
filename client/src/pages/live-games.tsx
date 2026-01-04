import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Calendar, Tv, Radio, ChevronLeft, ChevronRight, ArrowLeft, AlertTriangle, User } from "lucide-react";
import { format, addDays, subDays } from "date-fns";

interface LiveGame {
    id: string;
    date: string;
    status: {
        type: {
            name: string;
            state: string;
            completed: boolean;
            description: string;
            detail: string;
            shortDetail: string;
        };
        period: number;
        clock: number;
        displayClock: string;
    };
    competitors: {
        id: string;
        homeAway: string;
        winner?: boolean;
        team: {
            id: string;
            abbreviation: string;
            displayName: string;
            color: string;
            logo: string;
        };
        score: string;
    }[];
    headlines?: {
        description: string;
        shortLinkText: string;
    }[];
}

interface GameBoxScore {
    gameId: string;
    homeTeam: TeamBoxScore;
    awayTeam: TeamBoxScore;
}

interface TeamBoxScore {
    id: string;
    abbreviation: string;
    displayName: string;
    logo: string;
    score: string;
    players: PlayerStats[];
}

interface PlayerStats {
    id: string;
    displayName: string;
    jersey: string;
    position: string;
    stats: { [key: string]: string };
    starter: boolean;
}

interface RosterPlayer {
    id: string;
    fullName: string;
    displayName: string;
    jersey: string;
    position: {
        abbreviation: string;
        displayName: string;
    };
    headshot?: { href: string };
    injuries: { type: string; status: string; details?: { detail: string } }[];
    status: { name: string; abbreviation: string };
}

function formatDateForAPI(date: Date): string {
    return format(date, "yyyyMMdd");
}

export default function LiveGames() {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [selectedGame, setSelectedGame] = useState<LiveGame | null>(null);

    const dateStr = formatDateForAPI(selectedDate);

    const { data: games, isLoading, error } = useQuery<LiveGame[]>({
        queryKey: ["/api/live-games", dateStr],
        queryFn: async () => {
            const res = await fetch(`/api/live-games?date=${dateStr}`);
            if (!res.ok) throw new Error("Failed to fetch games");
            return res.json();
        },
        refetchInterval: 30000,
    });

    const goToPreviousDay = () => setSelectedDate(subDays(selectedDate, 1));
    const goToNextDay = () => setSelectedDate(addDays(selectedDate, 1));
    const goToToday = () => setSelectedDate(new Date());

    const isToday = format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

    // If game is selected, show detail view
    if (selectedGame) {
        return (
            <GameDetailView
                game={selectedGame}
                onBack={() => setSelectedGame(null)}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4 fade-in">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                        <Loader2 className="h-10 w-10 animate-spin text-primary relative" />
                    </div>
                    <span className="text-muted-foreground">Loading games...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center text-destructive fade-in">
                <div className="text-center">
                    <div className="text-4xl mb-2">⚠️</div>
                    <p className="font-semibold">Error loading games</p>
                    <p className="text-sm text-muted-foreground mt-1">Please try again later</p>
                </div>
            </div>
        );
    }

    const liveGames = games?.filter((g) => g.status.type.state === "in") || [];
    const scheduledGames = games?.filter((g) => g.status.type.state === "pre") || [];
    const finishedGames = games?.filter((g) => g.status.type.completed) || [];

    return (
        <div className="container mx-auto p-6 max-w-7xl fade-in">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-primary/10">
                    <Tv className="w-7 h-7 text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold tracking-tight">NBA Games</h1>
                    <p className="text-muted-foreground">Click on a game for details</p>
                </div>
                {liveGames.length > 0 && (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 flex items-center gap-1.5 px-3 py-1">
                        <Radio className="w-3 h-3 animate-pulse" />
                        {liveGames.length} Live
                    </Badge>
                )}
            </div>

            {/* Date Navigation */}
            <div className="flex items-center justify-center gap-4 mb-8 p-4 rounded-xl bg-card/50 border border-border/50">
                <Button variant="ghost" size="icon" onClick={goToPreviousDay} className="rounded-full hover:bg-primary/10">
                    <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-primary" />
                    <span className="text-xl font-bold">{format(selectedDate, "EEEE, MMMM d, yyyy")}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={goToNextDay} className="rounded-full hover:bg-primary/10">
                    <ChevronRight className="w-5 h-5" />
                </Button>
                {!isToday && (
                    <Button variant="outline" size="sm" onClick={goToToday} className="ml-4">
                        Today
                    </Button>
                )}
            </div>

            {/* Games */}
            {!games || games.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
                    <div className="relative w-20 h-20">
                        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 animate-pulse" />
                        <Calendar className="h-10 w-10 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/60" />
                    </div>
                    <p className="text-lg font-medium">No games on this day</p>
                    <p className="text-sm">Try selecting a different date</p>
                </div>
            ) : (
                <>
                    {liveGames.length > 0 && (
                        <section className="mb-8">
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-400">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                Live Now
                            </h2>
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-fade">
                                {liveGames.map((game) => (
                                    <GameCard key={game.id} game={game} onClick={() => setSelectedGame(game)} />
                                ))}
                            </div>
                        </section>
                    )}

                    {scheduledGames.length > 0 && (
                        <section className="mb-8">
                            <h2 className="text-lg font-semibold mb-4 text-muted-foreground">Upcoming</h2>
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-fade">
                                {scheduledGames.map((game) => (
                                    <GameCard key={game.id} game={game} onClick={() => setSelectedGame(game)} />
                                ))}
                            </div>
                        </section>
                    )}

                    {finishedGames.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold mb-4 text-muted-foreground">Final</h2>
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-fade">
                                {finishedGames.map((game) => (
                                    <GameCard key={game.id} game={game} onClick={() => setSelectedGame(game)} />
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}

function GameCard({ game, onClick }: { game: LiveGame; onClick: () => void }) {
    const homeTeam = game.competitors.find((c) => c.homeAway === "home");
    const awayTeam = game.competitors.find((c) => c.homeAway === "away");

    if (!homeTeam || !awayTeam) return null;

    const isLive = game.status.type.state === "in";
    const isFinished = game.status.type.completed;
    const isUpcoming = game.status.type.state === "pre";

    return (
        <Card
            className={`premium-card rounded-xl overflow-hidden transition-all duration-300 cursor-pointer ${isLive ? 'border-red-500/40 hover:border-red-500/60 shadow-lg shadow-red-500/10' : 'border-border/50 hover:border-primary/30'
                }`}
            onClick={onClick}
        >
            <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                    <Badge
                        className={`${isLive
                            ? "bg-red-500/20 text-red-400 border-red-500/30"
                            : isFinished
                                ? "bg-muted text-muted-foreground"
                                : "bg-primary/10 text-primary border-primary/20"
                            } ${isLive ? "pulse-live" : ""}`}
                    >
                        {game.status.type.shortDetail}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                        {format(new Date(game.date), "h:mm a")}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
                <div className="flex items-center justify-between py-4">
                    <div className="flex flex-col items-center gap-2 flex-1">
                        <div className="w-14 h-14 rounded-xl bg-muted/50 p-2 flex items-center justify-center">
                            <img
                                src={awayTeam.team.logo}
                                alt={awayTeam.team.displayName}
                                className="h-10 w-10 object-contain"
                            />
                        </div>
                        <span className="font-bold text-sm">{awayTeam.team.abbreviation}</span>
                        <span className={`text-3xl font-bold font-mono ${isFinished && awayTeam.winner ? 'text-primary' : ''}`}>
                            {isUpcoming ? "0" : (awayTeam.score || "-")}
                        </span>
                    </div>

                    <div className="px-4">
                        <span className="text-xl font-bold text-muted-foreground/50">VS</span>
                    </div>

                    <div className="flex flex-col items-center gap-2 flex-1">
                        <div className="w-14 h-14 rounded-xl bg-muted/50 p-2 flex items-center justify-center">
                            <img
                                src={homeTeam.team.logo}
                                alt={homeTeam.team.displayName}
                                className="h-10 w-10 object-contain"
                            />
                        </div>
                        <span className="font-bold text-sm">{homeTeam.team.abbreviation}</span>
                        <span className={`text-3xl font-bold font-mono ${isFinished && homeTeam.winner ? 'text-primary' : ''}`}>
                            {isUpcoming ? "0" : (homeTeam.score || "-")}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function GameDetailView({ game, onBack }: { game: LiveGame; onBack: () => void }) {
    const homeTeam = game.competitors.find((c) => c.homeAway === "home");
    const awayTeam = game.competitors.find((c) => c.homeAway === "away");
    const isFinished = game.status.type.completed;
    const isLive = game.status.type.state === "in";
    const isUpcoming = game.status.type.state === "pre";

    // Fetch box score for completed/live games
    const { data: boxScore, isLoading: boxScoreLoading } = useQuery<GameBoxScore>({
        queryKey: ["/api/games", game.id],
        queryFn: async () => {
            const res = await fetch(`/api/games/${game.id}`);
            if (!res.ok) throw new Error("Failed to fetch box score");
            return res.json();
        },
        enabled: isFinished || isLive,
    });

    // Fetch rosters for upcoming games
    const { data: homeRoster, isLoading: homeRosterLoading } = useQuery<RosterPlayer[]>({
        queryKey: ["/api/teams", homeTeam?.team.id, "roster"],
        queryFn: async () => {
            const res = await fetch(`/api/teams/${homeTeam?.team.id}/roster`);
            if (!res.ok) throw new Error("Failed to fetch roster");
            return res.json();
        },
        enabled: isUpcoming && !!homeTeam?.team.id,
    });

    const { data: awayRoster, isLoading: awayRosterLoading } = useQuery<RosterPlayer[]>({
        queryKey: ["/api/teams", awayTeam?.team.id, "roster"],
        queryFn: async () => {
            const res = await fetch(`/api/teams/${awayTeam?.team.id}/roster`);
            if (!res.ok) throw new Error("Failed to fetch roster");
            return res.json();
        },
        enabled: isUpcoming && !!awayTeam?.team.id,
    });

    if (!homeTeam || !awayTeam) return null;

    return (
        <div className="container mx-auto p-6 max-w-5xl fade-in">
            <Button variant="ghost" onClick={onBack} className="mb-6 hover:bg-primary/10">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Games
            </Button>

            {/* Game Header */}
            <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-6 mb-4">
                    <div className="flex flex-col items-center gap-2">
                        <img src={awayTeam.team.logo} alt={awayTeam.team.displayName} className="w-20 h-20 object-contain" />
                        <span className="text-xl font-bold">{awayTeam.team.abbreviation}</span>
                        <span className={`text-4xl font-bold font-mono ${isFinished && awayTeam.winner ? 'text-primary' : ''}`}>
                            {isUpcoming ? "0" : awayTeam.score}
                        </span>
                    </div>
                    <div className="text-2xl font-bold text-muted-foreground">VS</div>
                    <div className="flex flex-col items-center gap-2">
                        <img src={homeTeam.team.logo} alt={homeTeam.team.displayName} className="w-20 h-20 object-contain" />
                        <span className="text-xl font-bold">{homeTeam.team.abbreviation}</span>
                        <span className={`text-4xl font-bold font-mono ${isFinished && homeTeam.winner ? 'text-primary' : ''}`}>
                            {isUpcoming ? "0" : homeTeam.score}
                        </span>
                    </div>
                </div>
                <Badge className={isLive ? "bg-red-500/20 text-red-400" : isFinished ? "bg-muted" : "bg-primary/10 text-primary"}>
                    {game.status.type.shortDetail}
                </Badge>
                {isUpcoming && (
                    <p className="text-muted-foreground mt-2">Game has not started yet</p>
                )}
            </div>

            {/* Content based on game state */}
            {isUpcoming ? (
                // Show rosters for upcoming games
                <div className="grid md:grid-cols-2 gap-6">
                    <RosterCard
                        team={awayTeam.team}
                        roster={awayRoster}
                        isLoading={awayRosterLoading}
                        isAway
                    />
                    <RosterCard
                        team={homeTeam.team}
                        roster={homeRoster}
                        isLoading={homeRosterLoading}
                    />
                </div>
            ) : boxScoreLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : boxScore ? (
                // Show box score for live/finished games
                <div className="grid md:grid-cols-2 gap-6">
                    <BoxScoreCard team={boxScore.awayTeam} isAway />
                    <BoxScoreCard team={boxScore.homeTeam} />
                </div>
            ) : (
                <div className="text-center py-12 text-muted-foreground">
                    No stats available yet
                </div>
            )}
        </div>
    );
}

function RosterCard({ team, roster, isLoading, isAway = false }: {
    team: { logo: string; displayName: string; abbreviation: string };
    roster?: RosterPlayer[];
    isLoading: boolean;
    isAway?: boolean;
}) {
    const injuredPlayers = roster?.filter(p => p.injuries && p.injuries.length > 0) || [];
    const healthyPlayers = roster?.filter(p => !p.injuries || p.injuries.length === 0) || [];

    return (
        <Card className="rounded-xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <img src={team.logo} alt={team.displayName} className="w-10 h-10 object-contain" />
                    <div>
                        <h3 className="font-bold">{team.displayName}</h3>
                        <p className="text-xs text-muted-foreground">{isAway ? "Away" : "Home"} Team Roster</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto">
                {isLoading ? (
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="h-10 rounded shimmer" />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {injuredPlayers.length > 0 && (
                            <>
                                <div className="text-xs text-amber-400 font-semibold flex items-center gap-1 py-2">
                                    <AlertTriangle className="w-3 h-3" />
                                    Injury Report
                                </div>
                                {injuredPlayers.map(player => (
                                    <div key={player.id} className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                            {player.headshot?.href ? (
                                                <img src={player.headshot.href} alt="" className="w-8 h-8 rounded-full object-cover" />
                                            ) : (
                                                <User className="w-4 h-4 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium truncate">{player.displayName}</div>
                                            <div className="text-xs text-amber-400">
                                                {player.injuries[0]?.status} - {player.injuries[0]?.details?.detail || player.injuries[0]?.type}
                                            </div>
                                        </div>
                                        <span className="text-xs text-muted-foreground">{player.position?.abbreviation}</span>
                                    </div>
                                ))}
                                <div className="h-2" />
                            </>
                        )}
                        {healthyPlayers.slice(0, 12).map(player => (
                            <div key={player.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50">
                                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                    {player.headshot?.href ? (
                                        <img src={player.headshot.href} alt="" className="w-8 h-8 rounded-full object-cover" />
                                    ) : (
                                        <span className="text-xs font-bold">{player.jersey || "#"}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{player.displayName}</div>
                                </div>
                                <span className="text-xs text-muted-foreground">{player.position?.abbreviation}</span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function BoxScoreCard({ team, isAway = false }: { team: TeamBoxScore; isAway?: boolean }) {
    const starters = team.players.filter(p => p.starter);
    const bench = team.players.filter(p => !p.starter);

    return (
        <Card className="rounded-xl">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <img src={team.logo} alt={team.displayName} className="w-10 h-10 object-contain" />
                        <div>
                            <h3 className="font-bold">{team.displayName}</h3>
                            <p className="text-xs text-muted-foreground">{isAway ? "Away" : "Home"}</p>
                        </div>
                    </div>
                    <span className="text-2xl font-bold font-mono">{team.score}</span>
                </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border/50">
                            <th className="text-left py-2 font-medium">Player</th>
                            <th className="text-center py-2 font-medium">MIN</th>
                            <th className="text-center py-2 font-medium">PTS</th>
                            <th className="text-center py-2 font-medium">REB</th>
                            <th className="text-center py-2 font-medium">AST</th>
                        </tr>
                    </thead>
                    <tbody>
                        {starters.map(player => (
                            <tr key={player.id} className="border-b border-border/30">
                                <td className="py-2 font-medium">{player.displayName}</td>
                                <td className="text-center text-muted-foreground">{player.stats.MIN || "-"}</td>
                                <td className="text-center font-mono font-bold">{player.stats.PTS || "-"}</td>
                                <td className="text-center font-mono">{player.stats.REB || "-"}</td>
                                <td className="text-center font-mono">{player.stats.AST || "-"}</td>
                            </tr>
                        ))}
                        {bench.length > 0 && (
                            <tr>
                                <td colSpan={5} className="py-2 text-xs text-muted-foreground font-semibold">Bench</td>
                            </tr>
                        )}
                        {bench.slice(0, 5).map(player => (
                            <tr key={player.id} className="border-b border-border/30 text-muted-foreground">
                                <td className="py-2">{player.displayName}</td>
                                <td className="text-center">{player.stats.MIN || "-"}</td>
                                <td className="text-center font-mono">{player.stats.PTS || "-"}</td>
                                <td className="text-center font-mono">{player.stats.REB || "-"}</td>
                                <td className="text-center font-mono">{player.stats.AST || "-"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </CardContent>
        </Card>
    );
}
