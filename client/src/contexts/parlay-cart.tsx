import { createContext, useContext, useState, ReactNode } from "react";

export interface CartPick {
  playerId: string;
  playerName: string;
  team: string;
  stat: string;
  statTypeAbbr: string;
  line: number;
  side: "over" | "under";
  gameDate: string;
  imageUrl?: string;
}

interface ParlayCartContextType {
  picks: CartPick[];
  addPick: (pick: Omit<CartPick, "side">) => void;
  addMultiplePicks: (picks: Omit<CartPick, "side">[]) => void;
  removePick: (index: number) => void;
  updatePickSide: (index: number, side: "over" | "under") => void;
  clearCart: () => void;
}

const ParlayCartContext = createContext<ParlayCartContextType | undefined>(undefined);

export function ParlayCartProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<CartPick[]>([]);

  const addPick = (pick: Omit<CartPick, "side">) => {
    // Default to "over"
    setPicks((prev) => [...prev, { ...pick, side: "over" }]);
  };

  const addMultiplePicks = (newPicks: Omit<CartPick, "side">[]) => {
    // Add multiple picks at once (for bulk import)
    const picksWithSide = newPicks.map(pick => ({ ...pick, side: "over" as const }));
    setPicks((prev) => [...prev, ...picksWithSide]);
  };

  const removePick = (index: number) => {
    setPicks((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePickSide = (index: number, side: "over" | "under") => {
    setPicks((prev) =>
      prev.map((pick, i) => (i === index ? { ...pick, side } : pick))
    );
  };

  const clearCart = () => {
    setPicks([]);
  };

  return (
    <ParlayCartContext.Provider
      value={{ picks, addPick, addMultiplePicks, removePick, updatePickSide, clearCart }}
    >
      {children}
    </ParlayCartContext.Provider>
  );
}

export function useParlayCart() {
  const context = useContext(ParlayCartContext);
  if (!context) {
    throw new Error("useParlayCart must be used within a ParlayCartProvider");
  }
  return context;
}
