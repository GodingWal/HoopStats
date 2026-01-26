import { useState, useEffect, useCallback } from "react";

const FAVORITES_KEY = "courtside-edge-favorites";

/**
 * Custom hook for managing player favorites in localStorage
 */
export function useFavorites() {
    const [favorites, setFavorites] = useState<number[]>([]);

    // Load favorites from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(FAVORITES_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setFavorites(parsed);
                }
            }
        } catch (error) {
            console.error("Failed to load favorites:", error);
        }
    }, []);

    // Persist favorites to localStorage
    const persistFavorites = useCallback((newFavorites: number[]) => {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
        } catch (error) {
            console.error("Failed to save favorites:", error);
        }
    }, []);

    const addFavorite = useCallback((playerId: number) => {
        setFavorites((prev) => {
            if (prev.includes(playerId)) return prev;
            const updated = [...prev, playerId];
            persistFavorites(updated);
            return updated;
        });
    }, [persistFavorites]);

    const removeFavorite = useCallback((playerId: number) => {
        setFavorites((prev) => {
            const updated = prev.filter((id) => id !== playerId);
            persistFavorites(updated);
            return updated;
        });
    }, [persistFavorites]);

    const toggleFavorite = useCallback((playerId: number) => {
        if (favorites.includes(playerId)) {
            removeFavorite(playerId);
        } else {
            addFavorite(playerId);
        }
    }, [favorites, addFavorite, removeFavorite]);

    const isFavorite = useCallback((playerId: number) => {
        return favorites.includes(playerId);
    }, [favorites]);

    const clearFavorites = useCallback(() => {
        setFavorites([]);
        persistFavorites([]);
    }, [persistFavorites]);

    return {
        favorites,
        addFavorite,
        removeFavorite,
        toggleFavorite,
        isFavorite,
        clearFavorites,
        count: favorites.length,
    };
}
