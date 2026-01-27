/**
 * Shared utility functions for betting components
 */

/**
 * Get human-readable label for stat type
 */
export function getStatLabel(stat: string): string {
  switch (stat) {
    case "PTS": return "Points";
    case "REB": return "Rebounds";
    case "AST": return "Assists";
    case "PRA": return "PTS+REB+AST";
    case "FG3M": return "3-Pointers";
    case "FPTS": return "Fantasy Score";
    case "Fantasy Score": return "Fantasy Score";
    case "STL": return "Steals";
    case "BLK": return "Blocks";
    case "TO": return "Turnovers";
    case "PR": return "PTS+REB";
    case "PA": return "PTS+AST";
    case "RA": return "REB+AST";
    default: return stat;
  }
}

/**
 * Format game time to locale string
 */
export function formatGameTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Get badge color class based on edge type
 */
export function getEdgeBadgeColor(edgeType: string | undefined): string {
  if (!edgeType) return "";
  if (edgeType === "STAR_OUT") return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (edgeType === "STAR_OUT_POTENTIAL") return "bg-purple-500/10 text-purple-300 border-purple-500/20";
  if (edgeType === "BACK_TO_BACK") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (edgeType === "BLOWOUT_RISK") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (edgeType === "PACE_MATCHUP") return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
  if (edgeType === "BAD_DEFENSE") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (edgeType === "MINUTES_STABILITY") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (edgeType === "HOME_ROAD_SPLIT") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-primary/20 text-primary border-primary/30";
}

/**
 * Get human-readable edge label
 */
export function getEdgeLabel(edgeType: string | undefined): string {
  if (!edgeType) return "";
  return edgeType.replace(/_/g, " ");
}

/**
 * Stat type mapping from PrizePicks format to abbreviations
 */
export const STAT_MAPPING: Record<string, string> = {
  "points": "PTS",
  "rebounds": "REB",
  "assists": "AST",
  "pts+rebs+asts": "PRA",
  "pts+rebs": "PR",
  "pts+asts": "PA",
  "rebs+asts": "RA",
  "3-pointers made": "FG3M",
  "3-pointers": "FG3M",
  "steals": "STL",
  "blocks": "BLK",
  "turnovers": "TO",
  "fantasy score": "FPTS",
};

/**
 * Parse PrizePicks transaction log text format
 */
export function parsePrizePicksLog(text: string): Array<{
  playerName: string;
  line: number;
  stat: string;
  statAbbr: string;
  side: "over" | "under";
}> {
  const lines = text.trim().split('\n').filter(line => line.trim());
  const picks: Array<{
    playerName: string;
    line: number;
    stat: string;
    statAbbr: string;
    side: "over" | "under";
  }> = [];

  for (let i = 0; i < lines.length - 1; i += 2) {
    const playerName = lines[i].trim();
    const betLine = lines[i + 1]?.trim().toLowerCase() || "";

    const moreMatch = betLine.match(/more than\s+([\d.]+)\s+(.+)/);
    const lessMatch = betLine.match(/less than\s+([\d.]+)\s+(.+)/);

    const match = moreMatch || lessMatch;
    if (match) {
      const lineValue = parseFloat(match[1]);
      const statText = match[2].trim();
      const side: "over" | "under" = moreMatch ? "over" : "under";

      const statAbbr = STAT_MAPPING[statText] || statText.toUpperCase().replace(/\s+/g, "");

      picks.push({
        playerName,
        line: lineValue,
        stat: statText,
        statAbbr,
        side,
      });
    }
  }

  return picks;
}
