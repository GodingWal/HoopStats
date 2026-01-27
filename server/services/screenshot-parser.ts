/**
 * Screenshot Parser Service
 * Parses PrizePicks bet screenshots using OpenAI Vision API
 */

import OpenAI from "openai";
import { apiLogger } from "../logger";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ParsedPick {
  playerName: string;
  team: string;
  position: string;
  jerseyNumber?: string;
  stat: string;
  statAbbr: string;
  line: number;
  side: "over" | "under";
  actualValue?: number;
  result?: "hit" | "miss" | "pending";
}

export interface ParsedParlay {
  parlayType: string; // e.g., "6-Pick Flex Play"
  entryAmount: number;
  potentialPayout: number;
  picks: ParsedPick[];
  games: Array<{
    awayTeam: string;
    homeTeam: string;
    awayScore?: number;
    homeScore?: number;
    status: string; // "Final", "Q2 00:42", etc.
  }>;
  screenshotDate: string;
  platform: "prizepicks";
}

const STAT_MAPPING: Record<string, string> = {
  "fantasy score": "FPTS",
  "points": "PTS",
  "rebounds": "REB",
  "assists": "AST",
  "pra": "PRA",
  "pts+rebs+asts": "PRA",
  "pts+rebs": "PR",
  "pts+asts": "PA",
  "rebs+asts": "RA",
  "3-pointers made": "FG3M",
  "3-pointers": "FG3M",
  "steals": "STL",
  "blocks": "BLK",
  "turnovers": "TO",
};

function normalizeStatType(stat: string): string {
  const lower = stat.toLowerCase().trim();
  return STAT_MAPPING[lower] || stat.toUpperCase();
}

/**
 * Parse a PrizePicks screenshot using OpenAI Vision
 */
export async function parsePrizePicksScreenshot(
  imageBase64: string,
  mimeType: string = "image/png"
): Promise<ParsedParlay> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  apiLogger.info("Parsing PrizePicks screenshot with OpenAI Vision");

  const prompt = `Analyze this PrizePicks betting screenshot and extract the following information in JSON format:

{
  "parlayType": "string - e.g., '6-Pick Flex Play'",
  "entryAmount": "number - the dollar amount bet",
  "potentialPayout": "number - the potential payout amount",
  "screenshotDate": "string - date shown on screenshot in ISO format (YYYY-MM-DD)",
  "games": [
    {
      "awayTeam": "string - 3-letter abbreviation",
      "homeTeam": "string - 3-letter abbreviation",
      "awayScore": "number or null if not shown",
      "homeScore": "number or null if not shown",
      "status": "string - 'Final', 'Scheduled', or game clock like 'Q2 00:42'"
    }
  ],
  "picks": [
    {
      "playerName": "string - full player name",
      "team": "string - 3-letter team abbreviation",
      "position": "string - position abbreviation (G, F, C)",
      "jerseyNumber": "string - jersey number if shown",
      "stat": "string - the stat type (Fantasy Score, Points, PRA, etc.)",
      "line": "number - the betting line",
      "side": "string - 'over' or 'under' based on the arrow direction (↑ = over, ↓ = under)",
      "actualValue": "number or null - the actual stat value if shown in the progress bar, null if game hasn't started",
      "result": "string - 'hit' if green and past line, 'miss' if red, 'pending' if no result shown or game not started"
    }
  ]
}

Important notes:
- The arrow ↑ means OVER, arrow ↓ means UNDER
- If no progress bar or actual value is shown, the game hasn't started - set actualValue to null and result to 'pending'
- Green progress bars indicate the pick is winning/won
- If actual values are shown (numbers in the progress bars like 12.4, 40, 24.4), include them
- PRA means Points + Rebounds + Assists combined
- Extract ALL picks shown in the screenshot
- The format shows "Team • Position • #Number" under each player name
- Games that haven't started will show a scheduled time instead of a score

Return ONLY valid JSON, no markdown or explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.1, // Low temperature for more consistent parsing
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    let parsed: any;
    try {
      // Remove any markdown code blocks if present
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      apiLogger.error("Failed to parse OpenAI response as JSON", parseError, { content });
      throw new Error("Failed to parse screenshot data");
    }

    // Normalize the parsed data
    const result: ParsedParlay = {
      parlayType: parsed.parlayType || "Unknown",
      entryAmount: parseFloat(parsed.entryAmount) || 0,
      potentialPayout: parseFloat(parsed.potentialPayout) || 0,
      screenshotDate: parsed.screenshotDate || new Date().toISOString().split("T")[0],
      platform: "prizepicks",
      games: (parsed.games || []).map((g: any) => ({
        awayTeam: g.awayTeam?.toUpperCase() || "",
        homeTeam: g.homeTeam?.toUpperCase() || "",
        awayScore: g.awayScore ?? null,
        homeScore: g.homeScore ?? null,
        status: g.status || "Unknown",
      })),
      picks: (parsed.picks || []).map((p: any) => ({
        playerName: p.playerName || "",
        team: p.team?.toUpperCase() || "",
        position: p.position?.toUpperCase() || "",
        jerseyNumber: p.jerseyNumber || undefined,
        stat: p.stat || "",
        statAbbr: normalizeStatType(p.stat || ""),
        line: parseFloat(p.line) || 0,
        side: p.side?.toLowerCase() === "over" ? "over" : "under",
        actualValue: p.actualValue != null ? parseFloat(p.actualValue) : undefined,
        result: p.result || "pending",
      })),
    };

    apiLogger.info(`Successfully parsed ${result.picks.length} picks from screenshot`);
    return result;
  } catch (error) {
    apiLogger.error("Error parsing screenshot with OpenAI", error);
    throw error;
  }
}

/**
 * Determine if a pick hit based on actual value and line
 */
export function determineParlayPickResult(
  actualValue: number,
  line: number,
  side: "over" | "under"
): "hit" | "miss" | "push" {
  if (actualValue === line) {
    return "push";
  }

  if (side === "over") {
    return actualValue > line ? "hit" : "miss";
  } else {
    return actualValue < line ? "hit" : "miss";
  }
}

/**
 * Calculate parlay result from individual picks
 */
export function calculateParlayResult(
  picks: ParsedPick[]
): { result: "win" | "loss" | "push" | "pending"; hitsNeeded: number; hits: number } {
  const completedPicks = picks.filter(p => p.result && p.result !== "pending");
  const hits = completedPicks.filter(p => p.result === "hit").length;
  const misses = completedPicks.filter(p => p.result === "miss").length;

  // For flex plays, you typically need 5/6 or 6/6 to win
  // This is simplified - actual flex play rules are more complex
  const totalPicks = picks.length;
  const hitsNeeded = totalPicks >= 6 ? 5 : totalPicks >= 4 ? 3 : totalPicks;

  if (completedPicks.length < totalPicks) {
    return { result: "pending", hitsNeeded, hits };
  }

  if (misses > (totalPicks - hitsNeeded)) {
    return { result: "loss", hitsNeeded, hits };
  }

  if (hits >= hitsNeeded) {
    return { result: "win", hitsNeeded, hits };
  }

  return { result: "loss", hitsNeeded, hits };
}
