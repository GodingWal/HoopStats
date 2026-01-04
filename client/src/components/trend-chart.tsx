import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { GameLog } from "@shared/schema";

interface TrendChartProps {
    games: GameLog[];
    stat: "PTS" | "REB" | "AST" | "FG3M" | "PRA";
    seasonAvg?: number;
    className?: string;
}

const statLabels: Record<string, string> = {
    PTS: "Points",
    REB: "Rebounds",
    AST: "Assists",
    FG3M: "3-Pointers",
    PRA: "PTS+REB+AST",
};

const statColors: Record<string, string> = {
    PTS: "hsl(var(--chart-1))",
    REB: "hsl(var(--chart-2))",
    AST: "hsl(var(--chart-3))",
    FG3M: "hsl(var(--chart-4))",
    PRA: "hsl(var(--chart-5))",
};

export function TrendChart({ games, stat, seasonAvg, className = "" }: TrendChartProps) {
    const chartData = useMemo(() => {
        // Games come in reverse chronological order, flip for chart
        const reversed = [...games].reverse();

        return reversed.map((game, index) => {
            let value: number;
            if (stat === "PRA") {
                value = game.PTS + game.REB + game.AST;
            } else {
                value = game[stat] as number;
            }

            return {
                game: index + 1,
                date: game.GAME_DATE,
                opponent: game.OPPONENT,
                value,
                result: game.WL,
            };
        });
    }, [games, stat]);

    const maxValue = Math.max(...chartData.map((d) => d.value), seasonAvg ?? 0);
    const yMax = Math.ceil(maxValue * 1.1);

    if (chartData.length === 0) {
        return (
            <div className={`flex items-center justify-center h-40 text-muted-foreground ${className}`}>
                No game data available
            </div>
        );
    }

    return (
        <div className={className}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{statLabels[stat]} Trend</span>
                {seasonAvg && (
                    <span className="text-xs text-muted-foreground">
                        Season avg: {seasonAvg.toFixed(1)}
                    </span>
                )}
            </div>
            <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <XAxis
                        dataKey="game"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        domain={[0, yMax]}
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        width={30}
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (!active || !payload?.[0]) return null;
                            const data = payload[0].payload;
                            return (
                                <div className="bg-popover border rounded-lg shadow-lg p-2 text-xs">
                                    <div className="font-medium">{data.date}</div>
                                    <div className="text-muted-foreground">vs {data.opponent} ({data.result})</div>
                                    <div className="mt-1 font-bold" style={{ color: statColors[stat] }}>
                                        {statLabels[stat]}: {data.value}
                                    </div>
                                </div>
                            );
                        }}
                    />
                    {seasonAvg && (
                        <ReferenceLine
                            y={seasonAvg}
                            stroke="hsl(var(--muted-foreground))"
                            strokeDasharray="3 3"
                            strokeWidth={1}
                        />
                    )}
                    <Line
                        type="monotone"
                        dataKey="value"
                        stroke={statColors[stat]}
                        strokeWidth={2}
                        dot={{ fill: statColors[stat], strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 5, fill: statColors[stat] }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
