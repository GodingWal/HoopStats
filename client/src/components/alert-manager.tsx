import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Plus, Trash2, X } from "lucide-react";
import { useAlerts, type PlayerAlert } from "@/hooks/use-alerts";

interface AlertManagerProps {
    playerId: number;
    playerName: string;
    seasonAvg: {
        PTS: number;
        REB: number;
        AST: number;
        FG3M?: number;
        PRA?: number;
    };
}

const statOptions = [
    { value: "PTS", label: "Points" },
    { value: "REB", label: "Rebounds" },
    { value: "AST", label: "Assists" },
    { value: "FG3M", label: "3-Pointers" },
    { value: "PRA", label: "PTS+REB+AST" },
] as const;

export function AlertManager({ playerId, playerName, seasonAvg }: AlertManagerProps) {
    const { alerts, addAlert, removeAlert, toggleAlert, getAlertsForPlayer } = useAlerts();
    const [open, setOpen] = useState(false);
    const [stat, setStat] = useState<"PTS" | "REB" | "AST" | "FG3M" | "PRA">("PTS");
    const [operator, setOperator] = useState<"over" | "under">("over");
    const [threshold, setThreshold] = useState("");

    const playerAlerts = getAlertsForPlayer(playerId);

    const handleCreateAlert = () => {
        const thresholdNum = parseFloat(threshold);
        if (isNaN(thresholdNum) || thresholdNum < 0) return;

        addAlert({
            playerId,
            playerName,
            stat,
            operator,
            threshold: thresholdNum,
        });

        setThreshold("");
        setOpen(false);
    };

    const getSuggestedThreshold = (): string => {
        const avg = stat === "PRA"
            ? (seasonAvg.PRA ?? seasonAvg.PTS + seasonAvg.REB + seasonAvg.AST)
            : seasonAvg[stat] ?? 0;
        return avg.toFixed(1);
    };

    return (
        <div className="space-y-3">
            {/* Existing Alerts */}
            {playerAlerts.length > 0 && (
                <div className="space-y-2">
                    {playerAlerts.map((alert) => (
                        <div
                            key={alert.id}
                            className={`flex items-center justify-between p-2 rounded-lg border ${alert.enabled
                                    ? "bg-primary/5 border-primary/20"
                                    : "bg-muted/30 border-border/50"
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                {alert.enabled ? (
                                    <Bell className="w-4 h-4 text-primary" />
                                ) : (
                                    <BellOff className="w-4 h-4 text-muted-foreground" />
                                )}
                                <span className={`text-sm ${alert.enabled ? "" : "text-muted-foreground"}`}>
                                    {alert.stat} {alert.operator} {alert.threshold}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={alert.enabled}
                                    onCheckedChange={() => toggleAlert(alert.id)}
                                    className="scale-75"
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeAlert(alert.id)}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Alert Dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full gap-2">
                        <Plus className="w-4 h-4" />
                        Add Alert
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Create Alert for {playerName}</DialogTitle>
                        <DialogDescription>
                            Get notified when player stats hit your target.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Stat</Label>
                            <Select value={stat} onValueChange={(v) => setStat(v as typeof stat)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {statOptions.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Condition</Label>
                            <Select value={operator} onValueChange={(v) => setOperator(v as "over" | "under")}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="over">Over</SelectItem>
                                    <SelectItem value="under">Under</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label>Threshold</Label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs text-muted-foreground"
                                    onClick={() => setThreshold(getSuggestedThreshold())}
                                >
                                    Use avg ({getSuggestedThreshold()})
                                </Button>
                            </div>
                            <Input
                                type="number"
                                step="0.5"
                                placeholder="Enter value"
                                value={threshold}
                                onChange={(e) => setThreshold(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateAlert} disabled={!threshold}>
                            Create Alert
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Badge to show alert count for a player
export function AlertBadge({ playerId }: { playerId: number }) {
    const { getAlertsForPlayer } = useAlerts();
    const playerAlerts = getAlertsForPlayer(playerId);
    const enabledCount = playerAlerts.filter((a) => a.enabled).length;

    if (enabledCount === 0) return null;

    return (
        <Badge variant="outline" className="gap-1 text-xs bg-primary/10 border-primary/20">
            <Bell className="w-3 h-3" />
            {enabledCount}
        </Badge>
    );
}
