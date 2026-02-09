/**
 * CourtSide Edge - Referee Foul Signal Panel
 * ============================================
 * Drop this into your existing App.jsx as a new tab alongside
 * Overview, Hit Rates, Matchups, and Impact.
 *
 * Add to your tab navigation:
 *   { id: 'ref-signal', label: '🎯 Ref Signal' }
 *
 * Then render: {activeTab === 'ref-signal' && <RefFoulSignal />}
 */

import { useState, useMemo } from "react";

// ─── INLINE DATA (mirrors backend - for standalone/offline use) ───
const LEAGUE_AVG = 37.8;

const REFEREE_DB = {
  "Tony Brothers":    { fouls_pg: 42.3, diff: 4.5,  tier: "HIGH",     over_rate: 0.58 },
  "Scott Foster":     { fouls_pg: 41.8, diff: 4.0,  tier: "HIGH",     over_rate: 0.55 },
  "Kane Fitzgerald":  { fouls_pg: 41.2, diff: 3.4,  tier: "HIGH",     over_rate: 0.54 },
  "James Williams":   { fouls_pg: 40.8, diff: 3.0,  tier: "HIGH",     over_rate: 0.55 },
  "Ed Malloy":        { fouls_pg: 40.5, diff: 2.7,  tier: "HIGH",     over_rate: 0.53 },
  "Andy Nagy":        { fouls_pg: 39.9, diff: 2.1,  tier: "HIGH",     over_rate: 0.56 },
  "Curtis Blair":     { fouls_pg: 40.1, diff: 2.3,  tier: "HIGH",     over_rate: 0.52 },
  "Brent Barnaky":    { fouls_pg: 39.8, diff: 2.0,  tier: "MID-HIGH", over_rate: 0.51 },
  "Bill Kennedy":     { fouls_pg: 39.5, diff: 1.7,  tier: "MID-HIGH", over_rate: 0.51 },
  "Sean Corbin":      { fouls_pg: 39.2, diff: 1.4,  tier: "MID-HIGH", over_rate: 0.50 },
  "Rodney Mott":      { fouls_pg: 39.0, diff: 1.2,  tier: "MID",      over_rate: 0.49 },
  "Sha'Rae Mitchell": { fouls_pg: 38.8, diff: 1.0,  tier: "MID",      over_rate: 0.49 },
  "Leon Wood":        { fouls_pg: 38.7, diff: 0.9,  tier: "MID",      over_rate: 0.48 },
  "Tre Maddox":       { fouls_pg: 38.5, diff: 0.7,  tier: "MID",      over_rate: 0.47 },
  "Simone Jelks":     { fouls_pg: 38.2, diff: 0.4,  tier: "MID",      over_rate: 0.46 },
  "Marc Davis":       { fouls_pg: 38.0, diff: 0.2,  tier: "MID",      over_rate: 0.46 },
  "Zach Zarba":       { fouls_pg: 37.8, diff: 0.0,  tier: "MID",      over_rate: 0.45 },
  "Josh Tiven":       { fouls_pg: 37.5, diff:-0.3,  tier: "MID",      over_rate: 0.44 },
  "Natalie Sago":     { fouls_pg: 37.6, diff:-0.2,  tier: "MID",      over_rate: 0.44 },
  "Ben Taylor":       { fouls_pg: 37.2, diff:-0.6,  tier: "MID-LOW",  over_rate: 0.43 },
  "JB DeRosa":        { fouls_pg: 37.0, diff:-0.8,  tier: "MID-LOW",  over_rate: 0.42 },
  "Derrick Collins":  { fouls_pg: 36.8, diff:-1.0,  tier: "MID-LOW",  over_rate: 0.41 },
  "Jacyn Goble":      { fouls_pg: 37.0, diff:-0.8,  tier: "MID-LOW",  over_rate: 0.42 },
  "Eric Lewis":       { fouls_pg: 36.5, diff:-1.3,  tier: "LOW",      over_rate: 0.40 },
  "Karl Lane":        { fouls_pg: 36.2, diff:-1.6,  tier: "LOW",      over_rate: 0.39 },
  "Marat Kogut":      { fouls_pg: 36.0, diff:-1.8,  tier: "LOW",      over_rate: 0.38 },
  "Matt Boland":      { fouls_pg: 35.7, diff:-2.1,  tier: "LOW",      over_rate: 0.37 },
  "John Goble":       { fouls_pg: 35.5, diff:-2.3,  tier: "LOW",      over_rate: 0.36 },
  "Tyler Ford":       { fouls_pg: 35.2, diff:-2.6,  tier: "LOW",      over_rate: 0.35 },
};

const PLAYER_DB = {
  "Jaren Jackson Jr.":      { team: "MEM", pos: "PF", pf: 3.8, pf36: 4.3, tier: "VERY_HIGH", std: 1.1 },
  "Chet Holmgren":          { team: "OKC", pos: "PF", pf: 3.6, pf36: 4.3, tier: "VERY_HIGH", std: 1.0 },
  "Alperen Sengun":         { team: "HOU", pos: "C",  pf: 3.5, pf36: 3.9, tier: "VERY_HIGH", std: 1.0 },
  "Giannis Antetokounmpo":  { team: "MIL", pos: "PF", pf: 3.5, pf36: 3.5, tier: "HIGH",      std: 0.9 },
  "Victor Wembanyama":      { team: "SAS", pos: "C",  pf: 3.4, pf36: 3.7, tier: "HIGH",      std: 1.0 },
  "Nikola Jokic":           { team: "DEN", pos: "C",  pf: 3.3, pf36: 3.3, tier: "HIGH",      std: 0.8 },
  "Rudy Gobert":            { team: "MIN", pos: "C",  pf: 3.3, pf36: 3.9, tier: "HIGH",      std: 0.9 },
  "Jalen Duren":            { team: "DET", pos: "C",  pf: 3.3, pf36: 4.2, tier: "VERY_HIGH", std: 1.0 },
  "Domantas Sabonis":       { team: "SAC", pos: "C",  pf: 3.2, pf36: 3.3, tier: "HIGH",      std: 0.8 },
  "Karl-Anthony Towns":     { team: "NYK", pos: "C",  pf: 3.2, pf36: 3.3, tier: "HIGH",      std: 0.9 },
  "Walker Kessler":         { team: "UTA", pos: "C",  pf: 3.1, pf36: 4.6, tier: "VERY_HIGH", std: 1.1 },
  "Brook Lopez":            { team: "MIL", pos: "C",  pf: 3.1, pf36: 3.9, tier: "HIGH",      std: 0.9 },
  "Joel Embiid":            { team: "PHI", pos: "C",  pf: 3.1, pf36: 3.3, tier: "HIGH",      std: 0.9 },
  "Bam Adebayo":            { team: "MIA", pos: "C",  pf: 3.0, pf36: 3.1, tier: "HIGH",      std: 0.8 },
  "Scottie Barnes":         { team: "TOR", pos: "PF", pf: 3.0, pf36: 3.1, tier: "HIGH",      std: 0.8 },
  "Devin Booker":           { team: "PHX", pos: "SG", pf: 3.0, pf36: 3.1, tier: "MID_HIGH",  std: 0.8 },
  "Ivica Zubac":            { team: "LAC", pos: "C",  pf: 3.0, pf36: 3.6, tier: "HIGH",      std: 0.9 },
  "Isaiah Hartenstein":     { team: "OKC", pos: "C",  pf: 2.9, pf36: 3.8, tier: "HIGH",      std: 0.9 },
  "Nic Claxton":            { team: "BKN", pos: "C",  pf: 2.9, pf36: 3.6, tier: "HIGH",      std: 0.9 },
  "Daniel Gafford":         { team: "DAL", pos: "C",  pf: 2.8, pf36: 4.6, tier: "VERY_HIGH", std: 0.9 },
  "Anthony Davis":          { team: "LAL", pos: "PF", pf: 2.8, pf36: 2.8, tier: "MID_HIGH",  std: 0.8 },
  "Luka Doncic":            { team: "LAL", pos: "PG", pf: 2.8, pf36: 2.8, tier: "MID_HIGH",  std: 0.8 },
  "Dereck Lively II":       { team: "DAL", pos: "C",  pf: 2.7, pf36: 3.8, tier: "HIGH",      std: 0.9 },
  "De'Aaron Fox":           { team: "SAC", pos: "PG", pf: 2.7, pf36: 2.7, tier: "MID_HIGH",  std: 0.7 },
  "Evan Mobley":            { team: "CLE", pos: "PF", pf: 2.7, pf36: 2.9, tier: "MID_HIGH",  std: 0.7 },
  "Anthony Edwards":        { team: "MIN", pos: "SG", pf: 2.5, pf36: 2.5, tier: "MID",       std: 0.7 },
  "Donovan Mitchell":       { team: "CLE", pos: "SG", pf: 2.4, pf36: 2.5, tier: "MID",       std: 0.6 },
  "Jayson Tatum":           { team: "BOS", pos: "SF", pf: 2.3, pf36: 2.3, tier: "MID",       std: 0.6 },
  "Shai Gilgeous-Alexander":{ team: "OKC", pos: "PG", pf: 2.2, pf36: 2.3, tier: "MID",       std: 0.6 },
  "LeBron James":           { team: "LAL", pos: "SF", pf: 1.8, pf36: 1.9, tier: "LOW",       std: 0.5 },
  "Trae Young":             { team: "ATL", pos: "PG", pf: 1.5, pf36: 1.5, tier: "VERY_LOW",  std: 0.4 },
};

const TIER_UPLIFT = { "HIGH": 0.11, "MID-HIGH": 0.055, "MID": 0, "MID-LOW": -0.04, "LOW": -0.06 };

// ─── STYLES ───────────────────────────────────────────────────────
const S = {
  panel: {
    background: "#0a0e17",
    color: "#c8d6e5",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    fontSize: 13,
    minHeight: "100vh",
    padding: 24,
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    borderBottom: "1px solid #1a2332", paddingBottom: 16, marginBottom: 20,
  },
  title: { color: "#00ffc8", fontSize: 18, fontWeight: 700, letterSpacing: 1 },
  subtitle: { color: "#5a6a7a", fontSize: 11, marginTop: 4 },
  sectionTitle: {
    color: "#00ffc8", fontSize: 14, fontWeight: 600,
    borderBottom: "1px solid #1a2332", paddingBottom: 8, marginBottom: 12, marginTop: 24,
    letterSpacing: 0.5,
  },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  card: {
    background: "#0f1520", border: "1px solid #1a2332", borderRadius: 6,
    padding: 16, transition: "border-color 0.2s",
  },
  cardHover: { borderColor: "#00ffc8" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left", color: "#5a6a7a", fontSize: 10, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: 1, padding: "8px 10px",
    borderBottom: "1px solid #1a2332",
  },
  td: { padding: "7px 10px", borderBottom: "1px solid #0d1218", fontSize: 12 },
  input: {
    background: "#0a0e17", border: "1px solid #1a2332", borderRadius: 4,
    color: "#00ffc8", padding: "8px 12px", fontSize: 13, width: "100%",
    fontFamily: "inherit", outline: "none",
  },
  select: {
    background: "#0a0e17", border: "1px solid #1a2332", borderRadius: 4,
    color: "#c8d6e5", padding: "8px 12px", fontSize: 12, width: "100%",
    fontFamily: "inherit", outline: "none", cursor: "pointer",
  },
  btn: {
    background: "#00ffc8", color: "#0a0e17", border: "none", borderRadius: 4,
    padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", letterSpacing: 0.5, transition: "opacity 0.2s",
  },
  btnOutline: {
    background: "transparent", color: "#00ffc8", border: "1px solid #00ffc8",
    borderRadius: 4, padding: "6px 14px", fontSize: 11, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },
  badge: (color) => ({
    display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10,
    fontWeight: 700, letterSpacing: 0.5, background: color + "22", color: color,
    border: `1px solid ${color}44`,
  }),
  signalBar: (pct, color) => ({
    height: 6, borderRadius: 3, background: "#1a2332", position: "relative", overflow: "hidden",
    width: 80,
  }),
};

const tierColor = (tier) => {
  if (tier?.includes("HIGH") && !tier?.includes("MID")) return "#ff4757";
  if (tier?.includes("LOW") && !tier?.includes("MID")) return "#2ed573";
  return "#ffa502";
};

const actionEmoji = {
  SMASH_OVER: "🔥", STRONG_OVER: "✅", LEAN_OVER: "👀",
  SMASH_UNDER: "🔥", STRONG_UNDER: "✅", LEAN_UNDER: "👀",
  NO_PLAY: "⏸",
};

const actionColor = {
  SMASH_OVER: "#ff4757", STRONG_OVER: "#ff6348", LEAN_OVER: "#ffa502",
  SMASH_UNDER: "#2ed573", STRONG_UNDER: "#7bed9f", LEAN_UNDER: "#a4b0be",
  NO_PLAY: "#57606f",
};

// ─── COMPONENT ────────────────────────────────────────────────────

export default function RefFoulSignal() {
  const [selectedRefs, setSelectedRefs] = useState([]);
  const [refSearch, setRefSearch] = useState("");
  const [playerFilter, setPlayerFilter] = useState("ALL");
  const [lineOverrides, setLineOverrides] = useState({});
  const [paceFactor, setPaceFactor] = useState(1.0);
  const [b2b, setB2b] = useState(false);
  const [activeView, setActiveView] = useState("calculator"); // calculator | ref-table | player-table

  const refNames = Object.keys(REFEREE_DB);
  const filteredRefs = refNames.filter(n =>
    n.toLowerCase().includes(refSearch.toLowerCase()) && !selectedRefs.includes(n)
  );

  // Calculate crew composite
  const crewData = useMemo(() => {
    if (!selectedRefs.length) return null;
    const found = selectedRefs.map(r => REFEREE_DB[r]).filter(Boolean);
    if (!found.length) return null;
    const avgDiff = found.reduce((s, r) => s + r.diff, 0) / found.length;
    const avgFouls = found.reduce((s, r) => s + r.fouls_pg, 0) / found.length;
    let tier;
    if (avgDiff >= 2.0) tier = "HIGH";
    else if (avgDiff >= 1.0) tier = "MID-HIGH";
    else if (avgDiff >= -0.5) tier = "MID";
    else if (avgDiff >= -1.5) tier = "MID-LOW";
    else tier = "LOW";
    const uplift = TIER_UPLIFT[tier] ?? 0;
    return { tier, avgFouls: avgFouls.toFixed(1), avgDiff: avgDiff.toFixed(1), uplift };
  }, [selectedRefs]);

  // Calculate signals for all players
  const signals = useMemo(() => {
    if (!crewData) return [];
    return Object.entries(PLAYER_DB)
      .map(([name, p]) => {
        let proj = p.pf * (1 + crewData.uplift) * paceFactor;
        if (b2b) proj += 0.2;
        proj = Math.round(proj * 100) / 100;

        const defaultLine = ["VERY_HIGH", "HIGH", "MID_HIGH"].includes(p.tier) ? 3.5 : 2.5;
        const line = lineOverrides[name] ?? defaultLine;
        const signal = Math.round(((proj - line) / p.std) * 100) / 100;

        let action;
        if (signal >= 1.5) action = "SMASH_OVER";
        else if (signal >= 1.0) action = "STRONG_OVER";
        else if (signal >= 0.5) action = "LEAN_OVER";
        else if (signal <= -1.5) action = "SMASH_UNDER";
        else if (signal <= -1.0) action = "STRONG_UNDER";
        else if (signal <= -0.5) action = "LEAN_UNDER";
        else action = "NO_PLAY";

        return { name, ...p, projected: proj, line, signal, action };
      })
      .filter(s => {
        if (playerFilter === "ALL") return true;
        if (playerFilter === "ACTIONABLE") return s.action !== "NO_PLAY";
        if (playerFilter === "OVERS") return s.action.includes("OVER");
        if (playerFilter === "UNDERS") return s.action.includes("UNDER");
        return true;
      })
      .sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));
  }, [crewData, lineOverrides, paceFactor, b2b, playerFilter]);

  const addRef = (name) => {
    if (selectedRefs.length < 3) {
      setSelectedRefs([...selectedRefs, name]);
      setRefSearch("");
    }
  };

  const removeRef = (name) => setSelectedRefs(selectedRefs.filter(r => r !== name));

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.title}>🎯 REF FOUL SIGNAL</div>
          <div style={S.subtitle}>
            Referee foul tendencies × player foul proneness → PrizePicks edge
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["calculator", "ref-table", "player-table"].map(v => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              style={{
                ...S.btnOutline,
                ...(activeView === v ? { background: "#00ffc8", color: "#0a0e17" } : {}),
              }}
            >
              {v === "calculator" ? "⚡ Calculator" : v === "ref-table" ? "👨‍⚖️ Refs" : "🏀 Players"}
            </button>
          ))}
        </div>
      </div>

      {/* ─── CALCULATOR VIEW ─── */}
      {activeView === "calculator" && (
        <>
          {/* Ref Crew Builder */}
          <div style={S.sectionTitle}>STEP 1: SELECT REF CREW (up to 3)</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <input
                style={S.input}
                placeholder="Search referee name..."
                value={refSearch}
                onChange={e => setRefSearch(e.target.value)}
              />
              {refSearch && filteredRefs.length > 0 && (
                <div style={{
                  background: "#0f1520", border: "1px solid #1a2332", borderRadius: 4,
                  marginTop: 4, maxHeight: 200, overflowY: "auto",
                }}>
                  {filteredRefs.slice(0, 8).map(name => (
                    <div
                      key={name}
                      onClick={() => addRef(name)}
                      style={{
                        padding: "8px 12px", cursor: "pointer", display: "flex",
                        justifyContent: "space-between", alignItems: "center",
                        borderBottom: "1px solid #0d1218",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a2332"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span>{name}</span>
                      <span style={{
                        ...S.badge(tierColor(REFEREE_DB[name].tier)),
                        fontSize: 9,
                      }}>
                        {REFEREE_DB[name].tier} · {REFEREE_DB[name].fouls_pg} F/G
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selected refs */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              {selectedRefs.map(name => (
                <div key={name} style={{
                  background: "#1a2332", borderRadius: 4, padding: "6px 10px",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ color: "#00ffc8", fontSize: 12 }}>{name}</span>
                  <span
                    onClick={() => removeRef(name)}
                    style={{ color: "#ff4757", cursor: "pointer", fontSize: 14, fontWeight: 700 }}
                  >×</span>
                </div>
              ))}
            </div>
          </div>

          {/* Crew Composite */}
          {crewData && (
            <div style={{
              ...S.card, display: "flex", gap: 32, alignItems: "center",
              borderColor: tierColor(crewData.tier) + "44",
              marginBottom: 16,
            }}>
              <div>
                <div style={{ color: "#5a6a7a", fontSize: 10, textTransform: "uppercase" }}>Crew Tier</div>
                <div style={{ ...S.badge(tierColor(crewData.tier)), fontSize: 14, marginTop: 4 }}>
                  {crewData.tier}
                </div>
              </div>
              <div>
                <div style={{ color: "#5a6a7a", fontSize: 10 }}>AVG FOULS/G</div>
                <div style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>{crewData.avgFouls}</div>
              </div>
              <div>
                <div style={{ color: "#5a6a7a", fontSize: 10 }}>VS LEAGUE AVG</div>
                <div style={{
                  color: parseFloat(crewData.avgDiff) > 0 ? "#ff4757" : "#2ed573",
                  fontSize: 18, fontWeight: 700,
                }}>
                  {parseFloat(crewData.avgDiff) > 0 ? "+" : ""}{crewData.avgDiff}
                </div>
              </div>
              <div>
                <div style={{ color: "#5a6a7a", fontSize: 10 }}>FOUL UPLIFT</div>
                <div style={{
                  color: crewData.uplift > 0 ? "#ff4757" : crewData.uplift < 0 ? "#2ed573" : "#c8d6e5",
                  fontSize: 18, fontWeight: 700,
                }}>
                  {crewData.uplift > 0 ? "+" : ""}{(crewData.uplift * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          )}

          {/* Modifiers */}
          <div style={S.sectionTitle}>STEP 2: ADJUST MODIFIERS</div>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
            <div>
              <label style={{ color: "#5a6a7a", fontSize: 10, display: "block", marginBottom: 4 }}>PACE FACTOR</label>
              <select style={{ ...S.select, width: 160 }} value={paceFactor} onChange={e => setPaceFactor(parseFloat(e.target.value))}>
                <option value={0.95}>🐢 Slow (0.95)</option>
                <option value={1.0}>➡️ Average (1.0)</option>
                <option value={1.03}>⚡ Fast (1.03)</option>
                <option value={1.06}>🔥 Very Fast (1.06)</option>
              </select>
            </div>
            <div>
              <label style={{ color: "#5a6a7a", fontSize: 10, display: "block", marginBottom: 4 }}>BACK-TO-BACK</label>
              <button
                style={{
                  ...S.btnOutline,
                  ...(b2b ? { background: "#ffa502", color: "#0a0e17", borderColor: "#ffa502" } : {}),
                  padding: "8px 16px",
                }}
                onClick={() => setB2b(!b2b)}
              >
                {b2b ? "✅ B2B Active (+0.2 PF)" : "B2B Off"}
              </button>
            </div>
            <div>
              <label style={{ color: "#5a6a7a", fontSize: 10, display: "block", marginBottom: 4 }}>FILTER</label>
              <select style={{ ...S.select, width: 160 }} value={playerFilter} onChange={e => setPlayerFilter(e.target.value)}>
                <option value="ALL">All Players</option>
                <option value="ACTIONABLE">🎯 Actionable Only</option>
                <option value="OVERS">🔴 Overs Only</option>
                <option value="UNDERS">🟢 Unders Only</option>
              </select>
            </div>
          </div>

          {/* Signal Results */}
          <div style={S.sectionTitle}>
            STEP 3: SIGNALS ({signals.length} players)
          </div>

          {!crewData ? (
            <div style={{ ...S.card, textAlign: "center", padding: 40, color: "#5a6a7a" }}>
              ← Select referees above to generate foul signals
            </div>
          ) : signals.length === 0 ? (
            <div style={{ ...S.card, textAlign: "center", padding: 40, color: "#5a6a7a" }}>
              No actionable signals with current filters
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    {["Action", "Player", "Team", "Pos", "Base PF", "Projected", "Line", "Signal", "Foul Tier"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.map(s => (
                    <tr key={s.name} style={{ transition: "background 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#111927"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={S.td}>
                        <span style={{
                          ...S.badge(actionColor[s.action]),
                          fontSize: 11,
                        }}>
                          {actionEmoji[s.action]} {s.action.replace("_", " ")}
                        </span>
                      </td>
                      <td style={{ ...S.td, color: "#fff", fontWeight: 600 }}>{s.name}</td>
                      <td style={{ ...S.td, color: "#00ffc8" }}>{s.team}</td>
                      <td style={S.td}>{s.pos}</td>
                      <td style={S.td}>{s.pf.toFixed(1)}</td>
                      <td style={{
                        ...S.td, fontWeight: 700,
                        color: s.projected > s.pf ? "#ff4757" : s.projected < s.pf ? "#2ed573" : "#c8d6e5",
                      }}>
                        {s.projected.toFixed(2)}
                      </td>
                      <td style={S.td}>
                        <input
                          type="number"
                          step="0.5"
                          value={lineOverrides[s.name] ?? s.line}
                          onChange={e => setLineOverrides({
                            ...lineOverrides,
                            [s.name]: parseFloat(e.target.value) || s.line,
                          })}
                          style={{
                            ...S.input, width: 60, padding: "4px 8px", fontSize: 12,
                            textAlign: "center",
                          }}
                        />
                      </td>
                      <td style={{
                        ...S.td, fontWeight: 700, fontSize: 14,
                        color: s.signal > 0 ? "#ff4757" : s.signal < 0 ? "#2ed573" : "#c8d6e5",
                      }}>
                        {s.signal > 0 ? "+" : ""}{s.signal.toFixed(2)}
                      </td>
                      <td style={S.td}>
                        <span style={S.badge(tierColor(s.tier?.replace("_", "-")))}>
                          {s.tier?.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── REF TABLE VIEW ─── */}
      {activeView === "ref-table" && (
        <>
          <div style={S.sectionTitle}>ALL REFEREES — FOUL TENDENCIES (2024-25)</div>
          <table style={S.table}>
            <thead>
              <tr>
                {["Referee", "Fouls/Game", "Diff vs Avg", "Over Rate", "Tier"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(REFEREE_DB)
                .sort(([,a], [,b]) => b.fouls_pg - a.fouls_pg)
                .map(([name, r]) => (
                  <tr key={name}
                    style={{ cursor: "pointer" }}
                    onClick={() => { if (selectedRefs.length < 3 && !selectedRefs.includes(name)) { setSelectedRefs([...selectedRefs, name]); setActiveView("calculator"); }}}
                    onMouseEnter={e => e.currentTarget.style.background = "#111927"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ ...S.td, color: "#fff", fontWeight: 500 }}>{name}</td>
                    <td style={{ ...S.td, color: "#00ffc8", fontWeight: 700 }}>{r.fouls_pg}</td>
                    <td style={{
                      ...S.td, fontWeight: 600,
                      color: r.diff > 0 ? "#ff4757" : r.diff < 0 ? "#2ed573" : "#c8d6e5",
                    }}>
                      {r.diff > 0 ? "+" : ""}{r.diff.toFixed(1)}
                    </td>
                    <td style={S.td}>{(r.over_rate * 100).toFixed(0)}%</td>
                    <td style={S.td}><span style={S.badge(tierColor(r.tier))}>{r.tier}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {/* ─── PLAYER TABLE VIEW ─── */}
      {activeView === "player-table" && (
        <>
          <div style={S.sectionTitle}>ALL TRACKED PLAYERS — FOUL PRONENESS (2024-25)</div>
          <table style={S.table}>
            <thead>
              <tr>
                {["Player", "Team", "Pos", "PF/Game", "PF/36", "Std Dev", "Foul Tier"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(PLAYER_DB)
                .sort(([,a], [,b]) => b.pf - a.pf)
                .map(([name, p]) => (
                  <tr key={name}
                    onMouseEnter={e => e.currentTarget.style.background = "#111927"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ ...S.td, color: "#fff", fontWeight: 500 }}>{name}</td>
                    <td style={{ ...S.td, color: "#00ffc8" }}>{p.team}</td>
                    <td style={S.td}>{p.pos}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{p.pf.toFixed(1)}</td>
                    <td style={S.td}>{p.pf36.toFixed(1)}</td>
                    <td style={S.td}>{p.std}</td>
                    <td style={S.td}>
                      <span style={S.badge(tierColor(p.tier?.replace("_", "-")))}>
                        {p.tier?.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 32, padding: "16px 0", borderTop: "1px solid #1a2332",
        color: "#3a4a5a", fontSize: 10, textAlign: "center",
      }}>
        Sources: Basketball-Reference · RefMetrics · The F5 Substack · NBA.com Stats
        <br />Ref assignments drop daily at 9:00 AM ET → official.nba.com/referee-assignments/
      </div>
    </div>
  );
}
