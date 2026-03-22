import Anthropic from "@anthropic-ai/sdk";

function getClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is not set in environment variables");
    }
    return new Anthropic({ apiKey });
}

interface ExplanationRequest {
    player_name: string;
    prop: string; // e.g., "Points", "Rebounds"
    line: number;
    side: "OVER" | "UNDER";
    season_average: number;
    last_5_average: number;
    hit_rate: number;
    opponent: string;
}

export async function generateBetExplanation(
    request: ExplanationRequest
): Promise<string> {
    try {
        const client = getClient();
        const prompt = `
      You are an expert NBA sports bettor and analyst.
      Explain why taking the ${request.side} on ${request.player_name} for ${request.line} ${request.prop} is a good bet.

      Key Stats:
      - Season Average: ${request.season_average}
      - Last 5 Games Average: ${request.last_5_average}
      - Hit Rate (Last 10/20 games): ${request.hit_rate}%
      - Opponent: ${request.opponent}

      Provide a concise 3-4 bullet point explanation. Focus on form, matchup, and statistical value.
      Do not mention that you are an AI. Be confident but objective.
    `;

        const response = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 300,
            system: "You are a helpful and knowledgeable NBA sports betting analyst.",
            messages: [{ role: "user", content: prompt }],
        });

        return (
            (response.content[0] as Anthropic.TextBlock).text ||
            "Analysis currently unavailable. Please check the stats manually."
        );
    } catch (error) {
        console.error("Anthropic API Error:", error);
        return "AI analysis unavailable (Missing API configuration).";
    }
}

export interface ParsedBetSlip {
    entryAmount: number | null;
    potentialPayout: number | null;
    parlayType: "flex" | "power";
    numPicks: number;
    bets: Array<{
        playerName: string;
        line: number;
        stat: string;
        side: "over" | "under";
    }>;
}

export async function parseBetScreenshot(
    base64Image: string,
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg"
): Promise<ParsedBetSlip> {
    try {
        const client = getClient();
        const response = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 1500,
            system: "You are an expert at extracting data from betting slip images. Return ONLY valid JSON with no markdown formatting or code blocks.",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mediaType,
                                data: base64Image,
                            },
                        },
                        {
                            type: "text",
                            text: `Extract ALL information from this PrizePicks (or similar) betting slip image.

Return a JSON object with these fields:
- "entryAmount": the dollar amount wagered (e.g. if it says "$5 to pay $12,000" the entry is 5). null if not visible.
- "potentialPayout": the potential payout amount in dollars (e.g. if "$5 to pay $12,000" the payout is 12000). null if not visible.
- "parlayType": "flex" if it says "Flex Play" or "FLEX", "power" if it says "Power Play" or "POWER". Default to "flex".
- "numPicks": the number of picks (e.g. "6-Pick Flex Play" means 6). Count the individual player bets if not stated.
- "bets": an array where each object has:
  - "playerName" (string): full player name
  - "line" (number): the betting line number (e.g. 13.5)
  - "stat" (string): the stat type exactly as shown (e.g. "Points", "Rebs+Asts", "Rebounds", "3-Pointers Made")
  - "side" ("over" or "under"): "over" if arrow points up or is green/orange, "under" if arrow points down or is red. Default to "over".

IMPORTANT: Read the header of the slip carefully for entry amount and payout. For example "$5 to pay $12,000" means entryAmount=5 and potentialPayout=12000. Do NOT confuse the multiplier label (like "25x") with the actual payout ratio.`,
                        },
                    ],
                },
            ],
        });

        const text = (response.content[0] as Anthropic.TextBlock).text;
        if (!text) return { entryAmount: null, potentialPayout: null, parlayType: "flex", numPicks: 0, bets: [] };

        // Strip markdown code blocks if present
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const result = JSON.parse(cleaned);

        // Normalize the result
        const bets = result.bets || result.picks || [];
        return {
            entryAmount: result.entryAmount ?? null,
            potentialPayout: result.potentialPayout ?? null,
            parlayType: (result.parlayType || "flex").toLowerCase() === "power" ? "power" : "flex",
            numPicks: result.numPicks || bets.length,
            bets,
        };
    } catch (error) {
        console.error("Anthropic Vision Error:", error);
        throw new Error("Failed to parse screenshot. Please ensure Anthropic API key is configured.");
    }
}
