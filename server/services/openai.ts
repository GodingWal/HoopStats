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

export async function parseBetScreenshot(
    base64Image: string,
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg"
): Promise<any[]> {
    try {
        const client = getClient();
        const response = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 1000,
            system: "You are an expert at extracting data from images. Return ONLY valid JSON with no markdown formatting or code blocks.",
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
                            text: "Extract the bets from this PrizePicks (or similar) betting slip image. Return a JSON object with a 'bets' array where each object has: 'playerName' (string), 'line' (number), 'stat' (string - e.g. 'Points', 'Rebs+Asts'), 'side' ('over' or 'under'). If the side is not explicit, assume 'over' (More) if the arrow is green or pointing up, and 'under' (Less) if red or pointing down. If you cannot determine, default to 'over'.",
                        },
                    ],
                },
            ],
        });

        const text = (response.content[0] as Anthropic.TextBlock).text;
        if (!text) return [];

        // Strip markdown code blocks if present
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const result = JSON.parse(cleaned);
        return result.bets || result.picks || result;
    } catch (error) {
        console.error("Anthropic Vision Error:", error);
        throw new Error("Failed to parse screenshot. Please ensure Anthropic API key is configured.");
    }
}
