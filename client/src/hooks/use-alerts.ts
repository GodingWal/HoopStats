import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

const ALERTS_KEY = "courtside-edge-alerts";

export interface PlayerAlert {
    id: string;
    playerId: number;
    playerName: string;
    stat: "PTS" | "REB" | "AST" | "FG3M" | "PRA";
    operator: "over" | "under";
    threshold: number;
    enabled: boolean;
    createdAt: number;
}

/**
 * Custom hook for managing player alerts/notifications
 */
export function useAlerts() {
    const [alerts, setAlerts] = useState<PlayerAlert[]>([]);
    const { toast } = useToast();

    // Load alerts from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(ALERTS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setAlerts(parsed);
                }
            }
        } catch (error) {
            console.error("Failed to load alerts:", error);
        }
    }, []);

    // Persist alerts to localStorage
    const persistAlerts = useCallback((newAlerts: PlayerAlert[]) => {
        try {
            localStorage.setItem(ALERTS_KEY, JSON.stringify(newAlerts));
        } catch (error) {
            console.error("Failed to save alerts:", error);
        }
    }, []);

    const addAlert = useCallback((alert: Omit<PlayerAlert, "id" | "createdAt" | "enabled">) => {
        const newAlert: PlayerAlert = {
            ...alert,
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            enabled: true,
            createdAt: Date.now(),
        };

        setAlerts((prev) => {
            const updated = [...prev, newAlert];
            persistAlerts(updated);
            return updated;
        });

        toast({
            title: "Alert Created",
            description: `Alert for ${alert.playerName} ${alert.stat} ${alert.operator} ${alert.threshold}`,
        });

        return newAlert.id;
    }, [persistAlerts, toast]);

    const removeAlert = useCallback((alertId: string) => {
        setAlerts((prev) => {
            const updated = prev.filter((a) => a.id !== alertId);
            persistAlerts(updated);
            return updated;
        });
    }, [persistAlerts]);

    const toggleAlert = useCallback((alertId: string) => {
        setAlerts((prev) => {
            const updated = prev.map((a) =>
                a.id === alertId ? { ...a, enabled: !a.enabled } : a
            );
            persistAlerts(updated);
            return updated;
        });
    }, [persistAlerts]);

    const getAlertsForPlayer = useCallback((playerId: number) => {
        return alerts.filter((a) => a.playerId === playerId);
    }, [alerts]);

    const checkAlert = useCallback((alert: PlayerAlert, currentValue: number): boolean => {
        if (!alert.enabled) return false;

        if (alert.operator === "over") {
            return currentValue > alert.threshold;
        } else {
            return currentValue < alert.threshold;
        }
    }, []);

    const clearAlerts = useCallback(() => {
        setAlerts([]);
        persistAlerts([]);
    }, [persistAlerts]);

    return {
        alerts,
        addAlert,
        removeAlert,
        toggleAlert,
        getAlertsForPlayer,
        checkAlert,
        clearAlerts,
        count: alerts.length,
        enabledCount: alerts.filter((a) => a.enabled).length,
    };
}
