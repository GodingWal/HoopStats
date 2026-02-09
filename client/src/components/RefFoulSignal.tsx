/**
 * CourtSide Edge - Referee Foul Signal Panel
 * ============================================
 * Uses synced roster data for up-to-date player foul stats.
 * Falls back to static data when roster is unavailable.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

// ─── STATIC FALLBACK DATA ─────────────────────────────────────────
const REFEREE_DB: Record<string, { fouls_pg: number; diff: number; tier: string; over_rate: number }> = {
  "Tony Brothers": { fouls_pg: 42.3, diff: 4.5, tier: "HIGH", over_rate: 0.58 },
  "Scott Foster": { fouls_pg: 41.8, diff: 4.0, tier: "HIGH", over_rate: 0.55 },
  "Kane Fitzgerald": { fouls_pg: 41.2, diff: 3.4, tier: "HIGH", over_rate: 0.54 },
  "James Williams": { fouls_pg: 40.8, diff: 3.0, tier: "HIGH", over_rate: 0.55 },
  "Ed Malloy": { fouls_pg: 40.5, diff: 2.7, tier: "HIGH", over_rate: 0.53 },
  "Andy Nagy": { fouls_pg: 39.9, diff: 2.1, tier: "HIGH", over_rate: 0.56 },
  "Curtis Blair": { fouls_pg: 40.1, diff: 2.3, tier: "HIGH", over_rate: 0.52 },
  "Brent Barnaky": { fouls_pg: 39.8, diff: 2.0, tier: "MID-HIGH", over_rate: 0.51 },
  "Bill Kennedy": { fouls_pg: 39.5, diff: 1.7, tier: "MID-HIGH", over_rate: 0.51 },
  "Sean Corbin": { fouls_pg: 39.2, diff: 1.4, tier: "MID-HIGH", over_rate: 0.50 },
  "Rodney Mott": { fouls_pg: 39.0, diff: 1.2, tier: "MID", over_rate: 0.49 },
  "Sha'Rae Mitchell": { fouls_pg: 38.8, diff: 1.0, tier: "MID", over_rate: 0.49 },
  "Leon Wood": { fouls_pg: 38.7, diff: 0.9, tier: "MID", over_rate: 0.48 },
  "Tre Maddox": { fouls_pg: 38.5, diff: 0.7, tier: "MID", over_rate: 0.47 },
  "Simone Jelks": { fouls_pg: 38.2, diff: 0.4, tier: "MID", over_rate: 0.46 },
  "Marc Davis": { fouls_pg: 38.0, diff: 0.2, tier: "MID", over_rate: 0.46 },
  "Zach Zarba": { fouls_pg: 37.8, diff: 0.0, tier: "MID", over_rate: 0.45 },
  "Josh Tiven": { fouls_pg: 37.5, diff: -0.3, tier: "MID", over_rate: 0.44 },
  "Natalie Sago": { fouls_pg: 37.6, diff: -0.2, tier: "MID", over_rate: 0.44 },
  "Ben Taylor": { fouls_pg: 37.2, diff: -0.6, tier: "MID-LOW", over_rate: 0.43 },
  "JB DeRosa": { fouls_pg: 37.0, diff: -0.8, tier: "MID-LOW", over_rate: 0.42 },
  "Derrick Collins": { fouls_pg: 36.8, diff: -1.0, tier: "MID-LOW", over_rate: 0.41 },
  "Jacyn Goble": { fouls_pg: 37.0, diff: -0.8, tier: "MID-LOW", over_rate: 0.42 },
  "Eric Lewis": { fouls_pg: 36.5, diff: -1.3, tier: "LOW", over_rate: 0.40 },
  "Karl Lane": { fouls_pg: 36.2, diff: -1.6, tier: "LOW", over_rate: 0.39 },
  "Marat Kogut": { fouls_pg: 36.0, diff: -1.8, tier: "LOW", over_rate: 0.38 },
  "Matt Boland": { fouls_pg: 35.7, diff: -2.1, tier: "LOW", over_rate: 0.37 },
  "John Goble": { fouls_pg: 35.5, diff: -2.3, tier: "LOW", over_rate: 0.36 },
  "Tyler Ford": { fouls_pg: 35.2, diff: -2.6, tier: "LOW", over_rate: 0.35 },
};

const STATIC_PLAYER_DB: Record<string, { team: string; pos: string; pf: number; pf36: number; tier: string; std: number }> = {
  "Jaren Jackson Jr.": { team: "MEM", pos: "PF", pf: 3.8, pf36: 4.3, tier: "VERY_HIGH", std: 1.1 },
  "Chet Holmgren": { team: "OKC", pos: "PF", pf: 3.6, pf36: 4.3, tier: "VERY_HIGH", std: 1.0 },
  "Alperen Sengun": { team: "HOU", pos: "C", pf: 3.5, pf36: 3.9, tier: "VERY_HIGH", std: 1.0 },
  "Giannis Antetokounmpo": { team: "MIL", pos: "PF", pf: 3.5, pf36: 3.5, tier: "HIGH", std: 0.9 },
  "Victor Wembanyama": { team: "SAS", pos: "C", pf: 3.4, pf36: 3.7, tier: "HIGH", std: 1.0 },
  "Nikola Jokic": { team: "DEN", pos: "C", pf: 3.3, pf36: 3.3, tier: "HIGH", std: 0.8 },
  "Rudy Gobert": { team: "MIN", pos: "C", pf: 3.3, pf36: 3.9, tier: "HIGH", std: 0.9 },
  "Jalen Duren": { team: "DET", pos: "C", pf: 3.3, pf36: 4.2, tier: "VERY_HIGH", std: 1.0 },
  "Domantas Sabonis": { team: "SAC", pos: "C", pf: 3.2, pf36: 3.3, tier: "HIGH", std: 0.8 },
  "Karl-Anthony Towns": { team: "NYK", pos: "C", pf: 3.2, pf36: 3.3, tier: "HIGH", std: 0.9 },
  "Walker Kessler": { team: "UTA", pos: "C", pf: 3.1, pf36: 4.6, tier: "VERY_HIGH", std: 1.1 },
  "Brook Lopez": { team: "MIL", pos: "C", pf: 3.1, pf36: 3.9, tier: "HIGH", std: 0.9 },
  "Joel Embiid": { team: "PHI", pos: "C", pf: 3.1, pf36: 3.3, tier: "HIGH", std: 0.9 },
  "Bam Adebayo": { team: "MIA", pos: "C", pf: 3.0, pf36: 3.1, tier: "HIGH", std: 0.8 },
  "Scottie Barnes": { team: "TOR", pos: "PF", pf: 3.0, pf36: 3.1, tier: "HIGH", std: 0.8 },
  "Devin Booker": { team: "PHX", pos: "SG", pf: 3.0, pf36: 3.1, tier: "MID_HIGH", std: 0.8 },
  "Ivica Zubac": { team: "LAC", pos: "C", pf: 3.0, pf36: 3.6, tier: "HIGH", std: 0.9 },
  "Isaiah Hartenstein": { team: "OKC", pos: "C", pf: 2.9, pf36: 3.8, tier: "HIGH", std: 0.9 },
  "Nic Claxton": { team: "BKN", pos: "C", pf: 2.9, pf36: 3.6, tier: "HIGH", std: 0.9 },
  "Daniel Gafford": { team: "DAL", pos: "C", pf: 2.8, pf36: 4.6, tier: "VERY_HIGH", std: 0.9 },
  "Anthony Davis": { team: "LAL", pos: "PF", pf: 2.8, pf36: 2.8, tier: "MID_HIGH", std: 0.8 },
  "Luka Doncic": { team: "LAL", pos: "PG", pf: 2.8, pf36: 2.8, tier: "MID_HIGH", std: 0.8 },
  "Dereck Lively II": { team: "DAL", pos: "C", pf: 2.7, pf36: 3.8, tier: "HIGH", std: 0.9 },
  "De'Aaron Fox": { team: "SAC", pos: "PG", pf: 2.7, pf36: 2.7, tier: "MID_HIGH", std: 0.7 },
  "Evan Mobley": { team: "CLE", pos: "PF", pf: 2.7, pf36: 2.9, tier: "MID_HIGH", std: 0.7 },
  "Anthony Edwards": { team: "MIN", pos: "SG", pf: 2.5, pf36: 2.5, tier: "MID", std: 0.7 },
  "Donovan Mitchell": { team: "CLE", pos: "SG", pf: 2.4, pf36: 2.5, tier: "MID", std: 0.6 },
  "Jayson Tatum": { team: "BOS", pos: "SF", pf: 2.3, pf36: 2.3, tier: "MID", std: 0.6 },
  "Shai Gilgeous-Alexander": { team: "OKC", pos: "PG", pf: 2.2, pf36: 2.3, tier: "MID", std: 0.6 },
  "LeBron James": { team: "LAL", pos: "SF", pf: 1.8, pf36: 1.9, tier: "LOW", std: 0.5 },
  "Trae Young": { team: "ATL", pos: "PG", pf: 1.5, pf36: 1.5, tier: "VERY_LOW", std: 0.4 },
};

const TIER_UPLIFT: Record<string, number> = { "HIGH": 0.11, "MID-HIGH": 0.055, "MID": 0, "MID-LOW": -0.04, "LOW": -0.06 };

// ─── TYPES ───────────────────────────────────────────────────────
interface GameWithRefs {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  gameDate: string;
  referees: string[];
  crewTier?: string;
  avgFouls?: number;
}

interface PlayerFoulEntry {
  name: string;
  team: string;
  pos: string;
  pf: number;
  pf36: number;
  tier: string;
  std: number;
  games_played?: number;
  source: "roster" | "static";
}

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
  card: {
    background: "#0f1520", border: "1px solid #1a2332", borderRadius: 6,
    padding: 16, transition: "border-color 0.2s",
  },
  table: { width: "100%", borderCollapse: "collapse" as const },
  th: {
    textAlign: "left" as const, color: "#5a6a7a", fontSize: 10, fontWeight: 600,
    textTransform: "uppercase" as const, letterSpacing: 1, padding: "8px 10px",
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
  btnOutline: {
    background: "transparent", color: "#00ffc8", border: "1px solid #00ffc8",
    borderRadius: 4, padding: "6px 14px", fontSize: 11, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },
  badge: (color: string) => ({
    display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10,
    fontWeight: 700, letterSpacing: 0.5, background: color + "22", color: color,
    border: `1px solid ${color}44`,
  }),
  gameCard: {
    background: "#0f1520", border: "1px solid #1a2332", borderRadius: 8,
    padding: 16, cursor: "pointer", transition: "all 0.2s",
  },
  tableHeader: {
    background: "#0a0e17", borderBottom: "2px solid #1a2332",
  },
  tr: {
    transition: "background 0.15s",
  },
  primaryBtn: {
    background: "#00ffc8", color: "#0a0e17", border: "none", borderRadius: 6,
    padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", letterSpacing: 0.5, transition: "opacity 0.2s",
  },
};

const tierColor = (tier?: string) => {
  if (tier?.includes("HIGH") && !tier?.includes("MID")) return "#ff4757";
  if (tier?.includes("LOW") && !tier?.includes("MID")) return "#2ed573";
  return "#ffa502";
};

const actionEmoji: Record<string, string> = {
  SMASH_OVER: "\u{1F525}", STRONG_OVER: "\u2705", LEAN_OVER: "\u{1F440}",
  SMASH_UNDER: "\u{1F525}", STRONG_UNDER: "\u2705", LEAN_UNDER: "\u{1F440}",
  NO_PLAY: "\u23F8",
};

const actionColor: Record<string, string> = {
  SMASH_OVER: "#ff4757", STRONG_OVER: "#ff6348", LEAN_OVER: "#ffa502",
  SMASH_UNDER: "#2ed573", STRONG_UNDER: "#7bed9f", LEAN_UNDER: "#a4b0be",
  NO_PLAY: "#57606f",
};

// Team abbreviation mapping for matching
const TEAM_MAPPINGS: Record<string, string[]> = {
  "GS": ["GSW", "GS"], "NO": ["NOP", "NO"], "SA": ["SAS", "SA"],
  "NY": ["NYK", "NY"], "UTAH": ["UTA", "UTAH"],
};

function teamsMatch(playerTeam: string, gameTeam: string): boolean {
  const mapped = TEAM_MAPPINGS[gameTeam] || [gameTeam];
  return mapped.includes(playerTeam) || playerTeam === gameTeam;
}

// ─── COMPONENT ────────────────────────────────────────────────────

export default function RefFoulSignal() {
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [refSearch, setRefSearch] = useState("");
  const [playerFilter, setPlayerFilter] = useState("ALL");
  const [lineOverrides, setLineOverrides] = useState<Record<string, number>>({});
  const [paceFactor, setPaceFactor] = useState(1.0);
  const [b2b, setB2b] = useState(false);
  const [activeView, setActiveView] = useState("games-today");

  // Games state
  const [todayGames, setTodayGames] = useState<GameWithRefs[]>([]);
  const [tomorrowGames, setTomorrowGames] = useState<GameWithRefs[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameWithRefs | null>(null);

  // Roster player data from API
  const [rosterPlayers, setRosterPlayers] = useState<PlayerFoulEntry[]>([]);
  const [rosterMeta, setRosterMeta] = useState<{ roster_count: number; total: number } | null>(null);
  const [playersLoading, setPlayersLoading] = useState(false);

  // Player search in calculator
  const [playerSearch, setPlayerSearch] = useState("");

  // Build the active player database — roster data takes priority
  const playerDB: Record<string, { team: string; pos: string; pf: number; pf36: number; tier: string; std: number; games_played?: number; source: string }> = useMemo(() => {
    // Start with static data
    const db: Record<string, any> = {};
    for (const [name, p] of Object.entries(STATIC_PLAYER_DB)) {
      db[name] = { ...p, source: "static" };
    }
    // Overlay roster data (overrides static entries + adds new players)
    for (const rp of rosterPlayers) {
      db[rp.name] = {
        team: rp.team,
        pos: rp.pos,
        pf: rp.pf,
        pf36: rp.pf36,
        tier: rp.tier,
        std: rp.std,
        games_played: rp.games_played,
        source: rp.source,
      };
    }
    return db;
  }, [rosterPlayers]);

  // Fetch roster-based player foul data from API
  const fetchRosterPlayers = useCallback(async () => {
    setPlayersLoading(true);
    try {
      const res = await fetch("/api/ref-signal/players");
      if (res.ok) {
        const data = await res.json();
        const players: PlayerFoulEntry[] = (data.players || []).map((p: any) => ({
          name: p.name,
          team: p.team,
          pos: p.pos,
          pf: p.pf_pg,
          pf36: p.pf_36,
          tier: p.foul_tier,
          std: p.std_dev,
          games_played: p.games_played,
          source: p.source || "static",
        }));
        setRosterPlayers(players);
        setRosterMeta({ roster_count: data.roster_count, total: data.total });
      }
    } catch (err) {
      console.error("Failed to fetch roster players:", err);
    } finally {
      setPlayersLoading(false);
    }
  }, []);

  // Fetch games and roster data on mount
  useEffect(() => {
    const fetchGames = async () => {
      setGamesLoading(true);
      setGamesError(null);
      try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        const [todayRes, tomorrowRes] = await Promise.all([
          fetch(`/api/ref-signal/games?date=${today}`),
          fetch(`/api/ref-signal/games?date=${tomorrow}`)
        ]);

        if (todayRes.ok) {
          const data = await todayRes.json();
          setTodayGames(data.games || []);
        }
        if (tomorrowRes.ok) {
          const data = await tomorrowRes.json();
          setTomorrowGames(data.games || []);
        }
      } catch (err) {
        setGamesError("Failed to load games");
      } finally {
        setGamesLoading(false);
      }
    };
    fetchGames();
    fetchRosterPlayers();
  }, [fetchRosterPlayers]);

  // Get players for selected game's teams — now uses merged playerDB
  const getGamePlayers = (game: GameWithRefs) => {
    if (!game) return [];

    const teamAbbrs = [game.homeTeam, game.awayTeam];

    return Object.entries(playerDB)
      .filter(([_, p]) => teamAbbrs.some(abbr => teamsMatch(p.team, abbr)))
      .map(([name, p]) => {
        const crewUplift = TIER_UPLIFT[game.crewTier as keyof typeof TIER_UPLIFT] ?? 0;
        let proj = p.pf * (1 + crewUplift);
        proj = Math.round(proj * 100) / 100;

        const defaultLine = ["VERY_HIGH", "HIGH", "MID_HIGH"].includes(p.tier) ? 3.5 : 2.5;
        const signal = Math.round(((proj - defaultLine) / p.std) * 100) / 100;

        let action;
        if (signal >= 1.5) action = "SMASH_OVER";
        else if (signal >= 1.0) action = "STRONG_OVER";
        else if (signal >= 0.5) action = "LEAN_OVER";
        else if (signal <= -1.5) action = "SMASH_UNDER";
        else if (signal <= -1.0) action = "STRONG_UNDER";
        else if (signal <= -0.5) action = "LEAN_UNDER";
        else action = "NO_PLAY";

        return { name, ...p, projected: proj, line: defaultLine, signal, action };
      })
      .sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));
  };

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

  // Calculate signals for all players — now uses merged playerDB
  const signals = useMemo(() => {
    if (!crewData) return [];
    return Object.entries(playerDB)
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
      .filter(s => {
        if (!playerSearch) return true;
        return s.name.toLowerCase().includes(playerSearch.toLowerCase()) ||
               s.team.toLowerCase().includes(playerSearch.toLowerCase());
      })
      .sort((a, b) => Math.abs(b.signal) - Math.abs(a.signal));
  }, [crewData, lineOverrides, paceFactor, b2b, playerFilter, playerDB, playerSearch]);

  const addRef = (name: string) => {
    if (selectedRefs.length < 3) {
      setSelectedRefs([...selectedRefs, name]);
      setRefSearch("");
    }
  };

  const removeRef = (name: string) => setSelectedRefs(selectedRefs.filter(r => r !== name));

  // Data source badge
  const DataSourceBadge = () => {
    if (!rosterMeta) return null;
    const isRoster = rosterMeta.roster_count > 0;
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "#0f1520", border: "1px solid #1a2332", borderRadius: 6,
        padding: "6px 12px", fontSize: 11,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: isRoster ? "#2ed573" : "#ffa502",
        }} />
        <span style={{ color: "#5a6a7a" }}>
          {isRoster
            ? `${rosterMeta.roster_count} roster players + ${rosterMeta.total - rosterMeta.roster_count} static`
            : "Static data only"}
        </span>
        {isRoster && (
          <span style={S.badge("#2ed573")}>LIVE</span>
        )}
      </div>
    );
  };

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.title}>REF FOUL SIGNAL</div>
          <div style={S.subtitle}>
            Referee foul tendencies x player foul proneness = PrizePicks edge
          </div>
          <div style={{ marginTop: 8 }}>
            <DataSourceBadge />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { id: "games-today", label: "Today" },
            { id: "games-tomorrow", label: "Tomorrow" },
            { id: "calculator", label: "Calculator" },
            { id: "ref-table", label: "Refs" },
            { id: "player-table", label: "Players" },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              style={{
                ...S.btnOutline,
                ...(activeView === v.id ? { background: "#00ffc8", color: "#0a0e17" } : {}),
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── GAMES VIEW ─── */}
      {(activeView === "games-today" || activeView === "games-tomorrow") && (
        <>
          <div style={S.sectionTitle}>
            {activeView === "games-today" ? "TODAY'S GAMES" : "TOMORROW'S GAMES"}
            {gamesLoading && <span style={{ color: "#5a6a7a", marginLeft: 8 }}>Loading...</span>}
          </div>

          {gamesError && (
            <div style={{ ...S.card, color: "#ff4757", marginBottom: 16 }}>
              {gamesError}
            </div>
          )}

          {!gamesLoading && (activeView === "games-today" ? todayGames : tomorrowGames).length === 0 && (
            <div style={{ ...S.card, textAlign: "center", padding: 40, color: "#5a6a7a" }}>
              No games scheduled for this date
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {(activeView === "games-today" ? todayGames : tomorrowGames).map(game => {
              const gamePlayers = getGamePlayers(game);
              const actionablePlayers = gamePlayers.filter(p => p.action !== "NO_PLAY");
              return (
                <div
                  key={game.gameId}
                  onClick={() => setSelectedGame(game)}
                  style={{
                    ...S.gameCard,
                    borderColor: game.referees.length > 0 ? tierColor(game.crewTier) + "44" : "#1a2332",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#00ffc8")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = game.referees.length > 0 ? tierColor(game.crewTier) + "44" : "#1a2332")}
                >
                  {/* Matchup */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 } as React.CSSProperties}>
                      <span style={{ color: "#c8d6e5" }}>{game.awayTeam}</span>
                      <span style={{ color: "#5a6a7a", margin: "0 8px" }}>@</span>
                      <span style={{ color: "#00ffc8" }}>{game.homeTeam}</span>
                    </div>
                    <div style={{ color: "#5a6a7a", fontSize: 11 }}>{game.gameTime}</div>
                  </div>

                  {/* Referees */}
                  {game.referees.length > 0 ? (
                    <>
                      <div style={{ fontSize: 10, color: "#5a6a7a", marginBottom: 6, textTransform: "uppercase" }}>Officials</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                        {game.referees.map(ref => (
                          <span key={ref} style={S.badge("#00ffc8")}>{ref}</span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                        {game.crewTier && (
                          <div>
                            <div style={{ fontSize: 9, color: "#5a6a7a" }}>CREW TIER</div>
                            <span style={S.badge(tierColor(game.crewTier))}>{game.crewTier}</span>
                          </div>
                        )}
                        {game.avgFouls && (
                          <div>
                            <div style={{ fontSize: 9, color: "#5a6a7a" }}>AVG F/G</div>
                            <div style={{ color: "#fff", fontWeight: 700 }}>{game.avgFouls}</div>
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: 9, color: "#5a6a7a" }}>PLAYERS</div>
                          <div style={{ color: "#fff", fontWeight: 700 }}>{gamePlayers.length}</div>
                        </div>
                        {actionablePlayers.length > 0 && (
                          <div>
                            <div style={{ fontSize: 9, color: "#5a6a7a" }}>SIGNALS</div>
                            <div style={{ color: "#ff4757", fontWeight: 700 }}>{actionablePlayers.length}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 12, fontSize: 10, color: "#00ffc8" }}>
                        Click to analyze
                      </div>
                    </>
                  ) : (
                    <div style={{
                      padding: "12px 0",
                      color: "#ffa502",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      gap: 6
                    }}>
                      Refs not yet assigned (check after 9 AM ET)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

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
                        {REFEREE_DB[name].tier} | {REFEREE_DB[name].fouls_pg} F/G
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
                  >x</span>
                </div>
              ))}
            </div>
          </div>

          {/* Crew Composite */}
          {crewData && (
            <div style={{
              ...S.card, display: "flex", gap: 32, alignItems: "center",
              borderColor: tierColor(crewData.tier) + "44",
              marginBottom: 16, flexWrap: "wrap",
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
          <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <label style={{ color: "#5a6a7a", fontSize: 10, display: "block", marginBottom: 4 }}>PACE FACTOR</label>
              <select style={{ ...S.select, width: 160 }} value={paceFactor} onChange={e => setPaceFactor(parseFloat(e.target.value))}>
                <option value={0.95}>Slow (0.95)</option>
                <option value={1.0}>Average (1.0)</option>
                <option value={1.03}>Fast (1.03)</option>
                <option value={1.06}>Very Fast (1.06)</option>
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
                {b2b ? "B2B Active (+0.2 PF)" : "B2B Off"}
              </button>
            </div>
            <div>
              <label style={{ color: "#5a6a7a", fontSize: 10, display: "block", marginBottom: 4 }}>FILTER</label>
              <select style={{ ...S.select, width: 160 }} value={playerFilter} onChange={e => setPlayerFilter(e.target.value)}>
                <option value="ALL">All Players</option>
                <option value="ACTIONABLE">Actionable Only</option>
                <option value="OVERS">Overs Only</option>
                <option value="UNDERS">Unders Only</option>
              </select>
            </div>
            <div>
              <label style={{ color: "#5a6a7a", fontSize: 10, display: "block", marginBottom: 4 }}>SEARCH PLAYER</label>
              <input
                style={{ ...S.input, width: 180, padding: "8px 12px", fontSize: 12 }}
                placeholder="Name or team..."
                value={playerSearch}
                onChange={e => setPlayerSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Signal Results */}
          <div style={S.sectionTitle}>
            STEP 3: SIGNALS ({signals.length} players)
          </div>

          {!crewData ? (
            <div style={{ ...S.card, textAlign: "center", padding: 40, color: "#5a6a7a" }}>
              Select referees above to generate foul signals
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
                    {["Action", "Player", "Team", "Pos", "Base PF", "Projected", "Line", "Signal", "Foul Tier", "Source"].map(h => (
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
                      <td style={S.td}>
                        <span style={S.badge(s.source === "roster" ? "#2ed573" : "#5a6a7a")}>
                          {s.source === "roster" ? "ROSTER" : "STATIC"}
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
          <div style={S.sectionTitle}>ALL REFEREES - FOUL TENDENCIES</div>
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
                .sort(([, a], [, b]) => b.fouls_pg - a.fouls_pg)
                .map(([name, r]) => (
                  <tr key={name}
                    style={{ cursor: "pointer" }}
                    onClick={() => { if (selectedRefs.length < 3 && !selectedRefs.includes(name)) { setSelectedRefs([...selectedRefs, name]); setActiveView("calculator"); } }}
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
          <div style={{
            ...S.sectionTitle,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>ALL TRACKED PLAYERS - FOUL PRONENESS ({Object.keys(playerDB).length} players)</span>
            <button
              onClick={fetchRosterPlayers}
              disabled={playersLoading}
              style={{
                ...S.btnOutline,
                opacity: playersLoading ? 0.5 : 1,
                fontSize: 10,
              }}
            >
              {playersLoading ? "Refreshing..." : "Refresh from Roster"}
            </button>
          </div>

          {/* Player search filter */}
          <div style={{ marginBottom: 12 }}>
            <input
              style={{ ...S.input, maxWidth: 300 }}
              placeholder="Search player or team..."
              value={playerSearch}
              onChange={e => setPlayerSearch(e.target.value)}
            />
          </div>

          <table style={S.table}>
            <thead>
              <tr>
                {["Player", "Team", "Pos", "PF/Game", "PF/36", "Std Dev", "GP", "Foul Tier", "Source"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(playerDB)
                .filter(([name, p]) => {
                  if (!playerSearch) return true;
                  return name.toLowerCase().includes(playerSearch.toLowerCase()) ||
                         p.team.toLowerCase().includes(playerSearch.toLowerCase());
                })
                .sort(([, a], [, b]) => b.pf - a.pf)
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
                    <td style={S.td}>{p.games_played ?? "—"}</td>
                    <td style={S.td}>
                      <span style={S.badge(tierColor(p.tier?.replace("_", "-")))}>
                        {p.tier?.replace("_", " ")}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={S.badge(p.source === "roster" ? "#2ed573" : "#5a6a7a")}>
                        {p.source === "roster" ? "ROSTER" : "STATIC"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {/* Game Detail Modal */}
      {selectedGame && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.85)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20
          }}
          onClick={() => setSelectedGame(null)}
        >
          <div
            style={{
              background: "#0d1117", border: "1px solid #1a2332", borderRadius: 12,
              maxWidth: 900, width: "100%", maxHeight: "90vh", overflow: "auto",
              padding: 24
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
                  <span style={{ color: "#c8d6e5" }}>{selectedGame.awayTeam}</span>
                  <span style={{ color: "#5a6a7a", margin: "0 10px" }}>@</span>
                  <span style={{ color: "#00ffc8" }}>{selectedGame.homeTeam}</span>
                </div>
                <div style={{ color: "#5a6a7a", fontSize: 12, marginTop: 4 }}>{selectedGame.gameTime}</div>
              </div>
              <button
                onClick={() => setSelectedGame(null)}
                style={{
                  background: "#1a2332", border: "none", borderRadius: 8,
                  padding: "8px 16px", color: "#fff", cursor: "pointer",
                  fontSize: 14, fontWeight: 600
                }}
              >
                Close
              </button>
            </div>

            {/* Crew Info */}
            {selectedGame.referees.length > 0 && (
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#5a6a7a", marginBottom: 8, textTransform: "uppercase" }}>Referee Crew</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {selectedGame.referees.map(ref => (
                    <span key={ref} style={S.badge("#00ffc8")}>{ref}</span>
                  ))}
                </div>
                {selectedGame.crewTier && (
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#5a6a7a" }}>CREW TIER</div>
                      <span style={S.badge(tierColor(selectedGame.crewTier))}>{selectedGame.crewTier}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#5a6a7a" }}>AVG FOULS/G</div>
                      <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>{selectedGame.avgFouls}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#5a6a7a" }}>FOUL UPLIFT</div>
                      <div style={{ color: tierColor(selectedGame.crewTier), fontWeight: 700, fontSize: 16 }}>
                        {((TIER_UPLIFT[selectedGame.crewTier as keyof typeof TIER_UPLIFT] || 0) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Player Projections */}
            <div style={{ fontSize: 11, color: "#5a6a7a", marginBottom: 8, textTransform: "uppercase" }}>
              Player Foul Projections ({getGamePlayers(selectedGame).length} players)
            </div>

            {getGamePlayers(selectedGame).length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: 30, color: "#5a6a7a" }}>
                No tracked players for this matchup. Sync roster data or use the Calculator tab.
              </div>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr style={S.tableHeader}>
                    <th style={S.th}>Player</th>
                    <th style={S.th}>Team</th>
                    <th style={S.th}>Pos</th>
                    <th style={S.th}>Avg PF</th>
                    <th style={S.th}>Projected</th>
                    <th style={S.th}>Line</th>
                    <th style={S.th}>Signal</th>
                    <th style={S.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {getGamePlayers(selectedGame).map(p => (
                    <tr
                      key={p.name}
                      style={S.tr}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a2332"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ ...S.td, color: "#fff", fontWeight: 500 }}>{p.name}</td>
                      <td style={{ ...S.td, color: "#00ffc8" }}>{p.team}</td>
                      <td style={S.td}>{p.pos}</td>
                      <td style={S.td}>{p.pf.toFixed(1)}</td>
                      <td style={{ ...S.td, fontWeight: 700, color: p.projected > p.pf ? "#ff6348" : "#2ed573" }}>
                        {p.projected.toFixed(2)}
                      </td>
                      <td style={S.td}>{p.line}</td>
                      <td style={{ ...S.td, fontWeight: 700, color: actionColor[p.action as keyof typeof actionColor] }}>
                        {p.signal > 0 ? "+" : ""}{p.signal.toFixed(2)}
                      </td>
                      <td style={S.td}>
                        <span style={{
                          ...S.badge(actionColor[p.action as keyof typeof actionColor]),
                          fontSize: 9, padding: "3px 8px"
                        }}>
                          {p.action.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Actions */}
            <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
              <button
                onClick={() => {
                  if (selectedGame.referees.length > 0) {
                    setSelectedRefs(selectedGame.referees.map(r => r.replace(/\s*\(#?\d+\)\s*$/, '').trim()).slice(0, 3));
                    setActiveView("calculator");
                    setSelectedGame(null);
                  }
                }}
                style={{
                  ...S.primaryBtn,
                  flex: 1, padding: "12px 20px", fontSize: 14
                }}
              >
                Open in Calculator
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 32, padding: "16px 0", borderTop: "1px solid #1a2332",
        color: "#3a4a5a", fontSize: 10, textAlign: "center",
      }}>
        Sources: Basketball-Reference | RefMetrics | The F5 Substack | NBA.com Stats
        <br />Ref assignments drop daily at 9:00 AM ET | Player data from synced roster
      </div>
    </div>
  );
}
