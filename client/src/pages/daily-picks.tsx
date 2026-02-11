import { useState, useCallback } from "react";

interface EdgeType {
    id: string;
    label: string;
    icon: string;
    weight: number;
    desc: string;
}

const EDGE_TYPES: EdgeType[] = [
    { id: "injury", label: "Injury Spike", icon: "🩹", weight: 1.5, desc: "Star OUT → usage redistribution" },
    { id: "b2b", label: "Back-to-Back", icon: "😴", weight: 1.3, desc: "Fatigue factor on 2nd night" },
    { id: "referee", label: "Ref Patterns", icon: "🦓", weight: 1.2, desc: "Foul-calling tendencies" },
    { id: "pace", label: "Pace Mismatch", icon: "⚡", weight: 1.1, desc: "Fast vs slow matchup" },
    { id: "rest", label: "Rest Advantage", icon: "🛌", weight: 1.1, desc: "3+ days rest edge" },
    { id: "line", label: "Line Movement", icon: "📈", weight: 1.2, desc: "Sharp money signal" },
    { id: "blowout", label: "Blowout Risk", icon: "💨", weight: 1.0, desc: "Starters may sit Q4" },
    { id: "revenge", label: "Revenge/Motivation", icon: "🔥", weight: 0.8, desc: "Trade revenge, playoff push" },
];

interface PlayType {
    legs: number;
    type: string;
    payout: number;
    label: string;
}

const PLAY_TYPES: PlayType[] = [
    { legs: 2, type: "Power", payout: 3, label: "2-Pick Power (3x)" },
    { legs: 3, type: "Power", payout: 5, label: "3-Pick Power (5x)" },
    { legs: 3, type: "Flex", payout: 5, label: "3-Pick Flex (up to 5x)" },
    { legs: 4, type: "Power", payout: 10, label: "4-Pick Power (10x)" },
    { legs: 4, type: "Flex", payout: 10, label: "4-Pick Flex (up to 10x)" },
    { legs: 5, type: "Power", payout: 20, label: "5-Pick Power (20x)" },
    { legs: 5, type: "Flex", payout: 20, label: "5-Pick Flex (up to 20x)" },
    { legs: 6, type: "Power", payout: 25, label: "6-Pick Power (25x)" },
];

const PROP_TYPES = ["Points", "Rebounds", "Assists", "3PM", "PRA", "Pts+Reb", "Pts+Ast", "Reb+Ast", "Steals", "Blocks", "Blk+Stl", "Turnovers", "Fantasy"];

interface Conviction {
    grade: string;
    color: string;
    bg: string;
    label: string;
}

const getConviction = (score: number): Conviction => {
    if (score >= 85) return { grade: "A+", color: "#00ff87", bg: "rgba(0,255,135,0.12)", label: "MAX BET" };
    if (score >= 70) return { grade: "A", color: "#00d4ff", bg: "rgba(0,212,255,0.10)", label: "STANDARD" };
    if (score >= 55) return { grade: "B+", color: "#ffaa00", bg: "rgba(255,170,0,0.10)", label: "SMALL BET" };
    if (score >= 40) return { grade: "B", color: "#ff6b6b", bg: "rgba(255,107,107,0.08)", label: "MIN/SKIP" };
    return { grade: "C", color: "#666", bg: "rgba(102,102,102,0.08)", label: "NO BET" };
};

interface Phase {
    name: string;
    label: string;
    color: string;
    target: string;
    maxRisk: string;
}

const getPhase = (bankroll: number): Phase => {
    if (bankroll < 1000) return { name: "Phase 1", label: "SURVIVE", color: "#00ff87", target: "$1,000", maxRisk: "10-15%" };
    if (bankroll < 10000) return { name: "Phase 2", label: "ACCELERATE", color: "#ffaa00", target: "$10,000", maxRisk: "15-20%" };
    return { name: "Phase 3", label: "SWING", color: "#ff4444", target: "$100,000", maxRisk: "20-25%" };
};

const kellyBet = (bankroll: number, prob: number, payout: number) => {
    const q = 1 - prob;
    const b = payout - 1;
    const kelly = (prob * b - q) / b;
    return Math.max(0, Math.min(kelly * 0.5, 0.25)) * bankroll; // Half-Kelly capped at 25%
};

interface Leg {
    id: number;
    player: string;
    team: string;
    prop: string;
    line: string;
    direction: string;
    edges: string[];
    probability: number;
    notes: string;
}

interface Play {
    id: number;
    legs: Leg[];
    playType: PlayType;
    entry: number;
    score: number;
    conviction: Conviction;
    timestamp: string;
    result: "W" | "L" | null;
    pnl?: number;
}

export default function DailyPicksPage() {
    const [bankroll, setBankroll] = useState(100);
    const [legs, setLegs] = useState<Leg[]>([]);
    const [showAddLeg, setShowAddLeg] = useState(false);
    const [playHistory, setPlayHistory] = useState<Play[]>([]);
    const [activeTab, setActiveTab] = useState("builder");
    const [newLeg, setNewLeg] = useState<Omit<Leg, "id">>({
        player: "", team: "", prop: "Points", line: "", direction: "Over",
        edges: [], probability: 55, notes: ""
    });
    const [selectedPlayType, setSelectedPlayType] = useState<PlayType | null>(null);
    const [entryAmount, setEntryAmount] = useState("");

    const phase = getPhase(bankroll);

    const compositeScore = useCallback(() => {
        if (legs.length === 0) return 0;
        const avgProb = legs.reduce((s, l) => s + l.probability, 0) / legs.length;
        const totalEdgeWeight = legs.reduce((s, l) => s + l.edges.reduce((es, e) => {
            const edge = EDGE_TYPES.find(et => et.id === e);
            return es + (edge ? edge.weight : 0);
        }, 0), 0);
        const edgeBonus = Math.min(totalEdgeWeight * 5, 25);
        return Math.min(100, Math.round(avgProb + edgeBonus - (legs.length * 3)));
    }, [legs]);

    const addLeg = () => {
        if (!newLeg.player || !newLeg.line) return;
        setLegs([...legs, { ...newLeg, id: Date.now() }]);
        setNewLeg({ player: "", team: "", prop: "Points", line: "", direction: "Over", edges: [], probability: 55, notes: "" });
        setShowAddLeg(false);
    };

    const removeLeg = (id: number) => setLegs(legs.filter(l => l.id !== id));

    const toggleEdge = (edgeId: string) => {
        setNewLeg(prev => ({
            ...prev,
            edges: prev.edges.includes(edgeId)
                ? prev.edges.filter(e => e !== edgeId)
                : [...prev.edges, edgeId]
        }));
    };

    const lockPlay = () => {
        if (legs.length < 2 || !selectedPlayType || !entryAmount) return;
        const currentScore = compositeScore();
        const play: Play = {
            id: Date.now(),
            legs: [...legs],
            playType: selectedPlayType,
            entry: parseFloat(entryAmount),
            score: currentScore,
            conviction: getConviction(currentScore),
            timestamp: new Date().toLocaleString(),
            result: null,
        };
        setPlayHistory([play, ...playHistory]);
        setLegs([]);
        setSelectedPlayType(null);
        setEntryAmount("");
    };

    const markResult = (playId: number, result: "W" | "L") => {
        setPlayHistory(prev => prev.map(p => {
            if (p.id !== playId) return p;
            const pnl = result === "W" ? p.entry * p.playType.payout - p.entry : -p.entry;
            setBankroll(b => Math.round((b + pnl) * 100) / 100);
            return { ...p, result, pnl };
        }));
    };

    const score = compositeScore();
    const conviction = getConviction(score);
    const dailyLossLimit = bankroll * 0.30;
    const todayLoss = playHistory.filter(p => p.result === "L").reduce((s, p) => s + p.entry, 0);
    const hitDailyLimit = todayLoss >= dailyLossLimit;

    return (
        <div style={{
            minHeight: "calc(100vh - 57px)",
            background: "#0a0a0f",
            color: "#e0e0e0",
            fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
            padding: "0",
            overflowX: "hidden",
        }}>
            {/* Ambient glow */}
            <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 0,
                background: `radial-gradient(ellipse at 20% 0%, ${phase.color}08 0%, transparent 50%),
                     radial-gradient(ellipse at 80% 100%, #00d4ff06 0%, transparent 50%)`
            }} />

            <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "16px 12px" }}>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
                    <div>
                        <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, textTransform: "uppercase" }}>CourtSide Edge</div>
                        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, background: `linear-gradient(135deg, ${phase.color}, #00d4ff)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                            DAILY PLAY SELECTOR
                        </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>{phase.name} · {phase.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: phase.color }}>
                            ${bankroll.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                </div>

                {/* Stats Bar */}
                <div style={{
                    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16,
                }}>
                    {[
                        { label: "TARGET", value: phase.target, color: phase.color },
                        { label: "MAX/PLAY", value: `$${(bankroll * 0.20).toFixed(0)}`, color: "#00d4ff" },
                        { label: "DAILY LIMIT", value: `$${dailyLossLimit.toFixed(0)}`, color: hitDailyLimit ? "#ff4444" : "#ffaa00" },
                        { label: "TODAY LOSS", value: `$${todayLoss.toFixed(0)}`, color: todayLoss > 0 ? "#ff6b6b" : "#444" },
                    ].map((s, i) => (
                        <div key={i} style={{
                            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                            borderRadius: 8, padding: "10px 8px", textAlign: "center",
                        }}>
                            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</div>
                        </div>
                    ))}
                </div>

                {hitDailyLimit && (
                    <div style={{
                        background: "rgba(255,0,0,0.12)", border: "1px solid rgba(255,0,0,0.3)",
                        borderRadius: 8, padding: "12px 16px", marginBottom: 16, textAlign: "center",
                        animation: "pulse 2s infinite",
                    }}>
                        <span style={{ fontSize: 18 }}>🛑</span>
                        <span style={{ color: "#ff4444", fontWeight: 700, marginLeft: 8, fontSize: 13 }}>
                            DAILY LOSS LIMIT HIT — STOP BETTING TODAY
                        </span>
                    </div>
                )}

                {/* Tabs */}
                <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                    {[
                        { id: "builder", label: "🎯 Build Play" },
                        { id: "history", label: `📋 History (${playHistory.length})` },
                        { id: "bankroll", label: "💰 Bankroll" },
                    ].map(t => (
                        <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                            flex: 1, padding: "10px 8px", border: "1px solid",
                            borderColor: activeTab === t.id ? phase.color + "60" : "rgba(255,255,255,0.06)",
                            background: activeTab === t.id ? phase.color + "15" : "rgba(255,255,255,0.02)",
                            color: activeTab === t.id ? phase.color : "#666",
                            borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600,
                            fontFamily: "inherit", transition: "all 0.2s",
                        }}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* BUILD PLAY TAB */}
                {activeTab === "builder" && (
                    <div>
                        {/* Current Legs */}
                        {legs.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 8 }}>
                                    CURRENT LEGS ({legs.length})
                                </div>
                                {legs.map((leg) => (
                                    <div key={leg.id} style={{
                                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                                        borderRadius: 8, padding: "10px 12px", marginBottom: 6,
                                        display: "flex", alignItems: "center", justifyContent: "space-between",
                                    }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                <span style={{ color: "#00d4ff", fontWeight: 700, fontSize: 13 }}>{leg.player}</span>
                                                <span style={{ color: "#444", fontSize: 11 }}>{leg.team}</span>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                                                <span style={{
                                                    background: leg.direction === "Over" ? "rgba(0,255,135,0.15)" : "rgba(255,107,107,0.15)",
                                                    color: leg.direction === "Over" ? "#00ff87" : "#ff6b6b",
                                                    padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                                                }}>
                                                    {leg.direction} {leg.line}
                                                </span>
                                                <span style={{ color: "#888", fontSize: 11 }}>{leg.prop}</span>
                                                <span style={{ color: "#ffaa00", fontSize: 11 }}>{leg.probability}%</span>
                                                {leg.edges.map(e => {
                                                    const edge = EDGE_TYPES.find(et => et.id === e);
                                                    return edge ? <span key={e} style={{ fontSize: 12 }} title={edge.label}>{edge.icon}</span> : null;
                                                })}
                                            </div>
                                        </div>
                                        <button onClick={() => removeLeg(leg.id)} style={{
                                            background: "rgba(255,0,0,0.1)", border: "1px solid rgba(255,0,0,0.2)",
                                            color: "#ff4444", borderRadius: 6, width: 28, height: 28, cursor: "pointer",
                                            fontSize: 14, fontFamily: "inherit", flexShrink: 0, marginLeft: 8,
                                        }}>×</button>
                                    </div>
                                ))}

                                {/* Composite Score */}
                                <div style={{
                                    background: conviction.bg, border: `1px solid ${conviction.color}30`,
                                    borderRadius: 8, padding: "12px 16px", marginTop: 10,
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                }}>
                                    <div>
                                        <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5 }}>COMPOSITE SCORE</div>
                                        <div style={{ fontSize: 28, fontWeight: 800, color: conviction.color }}>{score}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{ fontSize: 22, fontWeight: 800, color: conviction.color }}>{conviction.grade}</div>
                                        <div style={{ fontSize: 10, color: conviction.color, letterSpacing: 1 }}>{conviction.label}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Add Leg Form */}
                        {showAddLeg ? (
                            <div style={{
                                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 10, padding: 16, marginBottom: 16,
                            }}>
                                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>ADD LEG</div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                                    <input placeholder="Player Name" value={newLeg.player}
                                        onChange={e => setNewLeg({ ...newLeg, player: e.target.value })}
                                        style={inputStyle as any} />
                                    <input placeholder="Team (e.g. LAL)" value={newLeg.team}
                                        onChange={e => setNewLeg({ ...newLeg, team: e.target.value })}
                                        style={inputStyle as any} />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                                    <select value={newLeg.prop} onChange={e => setNewLeg({ ...newLeg, prop: e.target.value })} style={inputStyle as any}>
                                        {PROP_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                    <input placeholder="Line (e.g. 24.5)" value={newLeg.line} type="number" step="0.5"
                                        onChange={e => setNewLeg({ ...newLeg, line: e.target.value })}
                                        style={inputStyle as any} />
                                    <div style={{ display: "flex", gap: 4 }}>
                                        {["Over", "Under"].map(d => (
                                            <button key={d} onClick={() => setNewLeg({ ...newLeg, direction: d })} style={{
                                                flex: 1, padding: "8px 4px",
                                                background: newLeg.direction === d
                                                    ? (d === "Over" ? "rgba(0,255,135,0.2)" : "rgba(255,107,107,0.2)")
                                                    : "rgba(255,255,255,0.03)",
                                                border: `1px solid ${newLeg.direction === d ? (d === "Over" ? "#00ff8740" : "#ff6b6b40") : "rgba(255,255,255,0.08)"}`,
                                                color: newLeg.direction === d ? (d === "Over" ? "#00ff87" : "#ff6b6b") : "#666",
                                                borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                                            }}>{d}</button>
                                        ))}
                                    </div>
                                </div>

                                {/* Probability Slider */}
                                <div style={{ marginBottom: 12 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontSize: 10, color: "#555", letterSpacing: 1.5 }}>MODEL PROBABILITY</span>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: newLeg.probability >= 55 ? "#00ff87" : "#ff6b6b" }}>
                                            {newLeg.probability}%
                                        </span>
                                    </div>
                                    <input type="range" min="30" max="80" value={newLeg.probability}
                                        onChange={e => setNewLeg({ ...newLeg, probability: parseInt(e.target.value) })}
                                        style={{ width: "100%", accentColor: phase.color }} />
                                </div>

                                {/* Edge Selection */}
                                <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>EDGES IDENTIFIED</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                                        {EDGE_TYPES.map(edge => {
                                            const active = newLeg.edges.includes(edge.id);
                                            return (
                                                <button key={edge.id} onClick={() => toggleEdge(edge.id)} style={{
                                                    padding: "8px 10px", textAlign: "left",
                                                    background: active ? "rgba(0,212,255,0.1)" : "rgba(255,255,255,0.02)",
                                                    border: `1px solid ${active ? "#00d4ff30" : "rgba(255,255,255,0.06)"}`,
                                                    borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                                                    transition: "all 0.15s",
                                                }}>
                                                    <div style={{ fontSize: 12 }}>
                                                        <span>{edge.icon}</span>
                                                        <span style={{ color: active ? "#00d4ff" : "#888", fontSize: 11, fontWeight: 600, marginLeft: 6 }}>
                                                            {edge.label}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>{edge.desc}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <input placeholder="Notes (optional)" value={newLeg.notes}
                                    onChange={e => setNewLeg({ ...newLeg, notes: e.target.value })}
                                    style={{ ...inputStyle, marginBottom: 10 } as any} />

                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={addLeg} disabled={!newLeg.player || !newLeg.line} style={{
                                        flex: 1, padding: "10px 16px", background: newLeg.player && newLeg.line ? "rgba(0,255,135,0.15)" : "rgba(255,255,255,0.03)",
                                        border: `1px solid ${newLeg.player && newLeg.line ? "#00ff8740" : "rgba(255,255,255,0.06)"}`,
                                        color: newLeg.player && newLeg.line ? "#00ff87" : "#444",
                                        borderRadius: 8, cursor: newLeg.player && newLeg.line ? "pointer" : "default",
                                        fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                                    }}>+ ADD LEG</button>
                                    <button onClick={() => setShowAddLeg(false)} style={{
                                        padding: "10px 16px", background: "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.06)", color: "#666",
                                        borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                                    }}>Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <button onClick={() => setShowAddLeg(true)} style={{
                                width: "100%", padding: "14px", background: "rgba(255,255,255,0.03)",
                                border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 10,
                                color: "#888", cursor: "pointer", fontSize: 13, fontWeight: 600,
                                fontFamily: "inherit", marginBottom: 16, transition: "all 0.2s",
                            }}>
                                + Add Leg to Play
                            </button>
                        )}

                        {/* Play Type & Lock */}
                        {legs.length >= 2 && (
                            <div style={{
                                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 10, padding: 16,
                            }}>
                                <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 10 }}>SELECT PLAY TYPE & ENTRY</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 12 }}>
                                    {PLAY_TYPES.filter(p => p.legs === legs.length || (p.legs <= legs.length && p.type === "Flex")).map((pt, i) => {
                                        const active = selectedPlayType?.label === pt.label;
                                        return (
                                            <button key={i} onClick={() => setSelectedPlayType(pt)} style={{
                                                padding: "8px 10px", textAlign: "left",
                                                background: active ? `${phase.color}18` : "rgba(255,255,255,0.02)",
                                                border: `1px solid ${active ? phase.color + "40" : "rgba(255,255,255,0.06)"}`,
                                                color: active ? phase.color : "#888",
                                                borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
                                                fontFamily: "inherit",
                                            }}>
                                                {pt.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {selectedPlayType && (
                                    <>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                                            <div>
                                                <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 4 }}>ENTRY AMOUNT</div>
                                                <input type="number" placeholder="$0.00" value={entryAmount}
                                                    onChange={e => setEntryAmount(e.target.value)}
                                                    style={{ ...inputStyle, fontSize: 16, fontWeight: 700, color: "#00d4ff" } as any} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 4 }}>POTENTIAL WIN</div>
                                                <div style={{ fontSize: 24, fontWeight: 800, color: "#00ff87", padding: "6px 0" }}>
                                                    ${entryAmount ? (parseFloat(entryAmount) * selectedPlayType.payout).toFixed(2) : "0.00"}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Kelly Suggestion */}
                                        <div style={{
                                            background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.15)",
                                            borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 11,
                                        }}>
                                            <span style={{ color: "#555" }}>Half-Kelly suggests: </span>
                                            <span style={{ color: "#00d4ff", fontWeight: 700 }}>
                                                ${kellyBet(bankroll, score / 100, selectedPlayType.payout).toFixed(2)}
                                            </span>
                                            <span style={{ color: "#555" }}> | Max risk: </span>
                                            <span style={{ color: "#ffaa00", fontWeight: 700 }}>
                                                ${(bankroll * 0.20).toFixed(2)}
                                            </span>
                                        </div>

                                        <button onClick={lockPlay} disabled={!entryAmount || hitDailyLimit}
                                            style={{
                                                width: "100%", padding: "14px",
                                                background: hitDailyLimit ? "rgba(255,0,0,0.1)" : `linear-gradient(135deg, ${phase.color}30, #00d4ff20)`,
                                                border: `1px solid ${hitDailyLimit ? "rgba(255,0,0,0.3)" : phase.color + "50"}`,
                                                color: hitDailyLimit ? "#ff4444" : phase.color,
                                                borderRadius: 10, cursor: hitDailyLimit ? "default" : "pointer",
                                                fontSize: 14, fontWeight: 800, fontFamily: "inherit",
                                                letterSpacing: 1, transition: "all 0.2s",
                                            }}>
                                            {hitDailyLimit ? "🛑 DAILY LIMIT HIT" : "🔒 LOCK IN PLAY"}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* HISTORY TAB */}
                {activeTab === "history" && (
                    <div>
                        {playHistory.length === 0 ? (
                            <div style={{ textAlign: "center", padding: 40, color: "#444" }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                                <div style={{ fontSize: 13 }}>No plays logged yet. Build your first play!</div>
                            </div>
                        ) : (
                            playHistory.map(play => (
                                <div key={play.id} style={{
                                    background: "rgba(255,255,255,0.03)", border: `1px solid ${play.result === "W" ? "#00ff8730" : play.result === "L" ? "#ff444430" : "rgba(255,255,255,0.06)"}`,
                                    borderRadius: 10, padding: 14, marginBottom: 8,
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{
                                                background: play.conviction.bg, color: play.conviction.color,
                                                padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                                            }}>{play.conviction.grade}</span>
                                            <span style={{ color: "#888", fontSize: 11 }}>{play.playType.label}</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ color: "#888", fontSize: 10 }}>{play.timestamp}</span>
                                            {play.result && (
                                                <span style={{
                                                    background: play.result === "W" ? "rgba(0,255,135,0.2)" : "rgba(255,68,68,0.2)",
                                                    color: play.result === "W" ? "#00ff87" : "#ff4444",
                                                    padding: "2px 10px", borderRadius: 4, fontSize: 12, fontWeight: 800,
                                                }}>
                                                    {play.result === "W" ? `+$${play.pnl?.toFixed(2)}` : `-$${Math.abs(play.pnl || 0).toFixed(2)}`}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {play.legs.map((leg, i) => (
                                        <div key={i} style={{
                                            display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                                            borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
                                            flexWrap: "wrap",
                                        }}>
                                            <span style={{ color: "#00d4ff", fontSize: 12, fontWeight: 600 }}>{leg.player}</span>
                                            <span style={{
                                                color: leg.direction === "Over" ? "#00ff87" : "#ff6b6b",
                                                fontSize: 11, fontWeight: 600,
                                            }}>{leg.direction} {leg.line}</span>
                                            <span style={{ color: "#555", fontSize: 11 }}>{leg.prop}</span>
                                            {leg.edges.map(e => {
                                                const edge = EDGE_TYPES.find(et => et.id === e);
                                                return edge ? <span key={e} style={{ fontSize: 11 }}>{edge.icon}</span> : null;
                                            })}
                                        </div>
                                    ))}

                                    {!play.result && (
                                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                            <button onClick={() => markResult(play.id, "W")} style={{
                                                flex: 1, padding: "8px", background: "rgba(0,255,135,0.1)",
                                                border: "1px solid rgba(0,255,135,0.25)", color: "#00ff87",
                                                borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                                            }}>✓ WIN</button>
                                            <button onClick={() => markResult(play.id, "L")} style={{
                                                flex: 1, padding: "8px", background: "rgba(255,68,68,0.1)",
                                                border: "1px solid rgba(255,68,68,0.25)", color: "#ff4444",
                                                borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                                            }}>✗ LOSS</button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* BANKROLL TAB */}
                {activeTab === "bankroll" && (
                    <div>
                        <div style={{
                            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 10, padding: 16, marginBottom: 12,
                        }}>
                            <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 8 }}>SET BANKROLL</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ color: "#555", fontSize: 18 }}>$</span>
                                <input type="number" value={bankroll}
                                    onChange={e => setBankroll(parseFloat(e.target.value) || 0)}
                                    style={{ ...inputStyle, flex: 1, fontSize: 22, fontWeight: 800, color: phase.color } as any} />
                            </div>
                        </div>

                        {/* Milestone Tracker */}
                        <div style={{
                            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 10, padding: 16, marginBottom: 12,
                        }}>
                            <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>MILESTONE PROGRESS</div>
                            {[
                                { target: 250, label: "$250" },
                                { target: 500, label: "$500" },
                                { target: 1000, label: "$1K" },
                                { target: 2500, label: "$2.5K" },
                                { target: 5000, label: "$5K" },
                                { target: 10000, label: "$10K" },
                                { target: 25000, label: "$25K" },
                                { target: 50000, label: "$50K" },
                                { target: 100000, label: "$100K 🏆" },
                            ].map((m, i) => {
                                const pct = Math.min(100, (bankroll / m.target) * 100);
                                const hit = bankroll >= m.target;
                                return (
                                    <div key={i} style={{ marginBottom: 8 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                            <span style={{ fontSize: 11, color: hit ? "#00ff87" : "#888", fontWeight: hit ? 700 : 400 }}>
                                                {hit ? "✓ " : ""}{m.label}
                                            </span>
                                            <span style={{ fontSize: 10, color: "#555" }}>{pct.toFixed(0)}%</span>
                                        </div>
                                        <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                                            <div style={{
                                                height: "100%", width: `${pct}%`, borderRadius: 2,
                                                background: hit ? "#00ff87" : `linear-gradient(90deg, ${phase.color}, #00d4ff)`,
                                                transition: "width 0.5s ease",
                                            }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Session Stats */}
                        <div style={{
                            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 10, padding: 16,
                        }}>
                            <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>SESSION STATS</div>
                            {[
                                { label: "Total Plays", value: playHistory.length },
                                { label: "Wins", value: playHistory.filter(p => p.result === "W").length, color: "#00ff87" },
                                { label: "Losses", value: playHistory.filter(p => p.result === "L").length, color: "#ff4444" },
                                {
                                    label: "Win Rate", value: playHistory.filter(p => p.result).length > 0
                                        ? (playHistory.filter(p => p.result === "W").length / playHistory.filter(p => p.result).length * 100).toFixed(1) + "%"
                                        : "N/A"
                                },
                                {
                                    label: "Total P&L", value: "$" + playHistory.reduce((s, p) => s + (p.pnl || 0), 0).toFixed(2),
                                    color: playHistory.reduce((s, p) => s + (p.pnl || 0), 0) >= 0 ? "#00ff87" : "#ff4444"
                                },
                                {
                                    label: "ROI", value: playHistory.reduce((s, p) => s + (p.pnl || 0), 0) !== 0
                                        ? ((playHistory.reduce((s, p) => s + (p.pnl || 0), 0) / 100) * 100).toFixed(1) + "%"
                                        : "0%"
                                },
                            ].map((s, i) => (
                                <div key={i} style={{
                                    display: "flex", justifyContent: "space-between", padding: "6px 0",
                                    borderBottom: i < 5 ? "1px solid rgba(255,255,255,0.04)" : "none",
                                } as any}>
                                    <span style={{ color: "#888", fontSize: 12 }}>{s.label}</span>
                                    <span style={{ color: s.color || "#e0e0e0", fontSize: 13, fontWeight: 700 }}>{s.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div style={{ textAlign: "center", padding: "20px 0 8px", color: "#333", fontSize: 9, letterSpacing: 1 }}>
                    COURTSIDE EDGE × PRIZEPICKS $100K CHALLENGE
                </div>
            </div>
        </div>
    );
}

const inputStyle = {
    width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px",
    color: "#e0e0e0", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
    outline: "none", boxSizing: "border-box",
};
