
import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful and knowledgeable NBA sports betting analyst.",
                },
                { role: "user", content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 200,
        });

        return (
            response.choices[0].message.content ||
            "Analysis currently unavailable. Please check the stats manually."
        );
    } catch (error) {
        console.error("OpenAI API Error:", error);
        throw new Error("Failed to generate explanation");
    }
}

export async function parseBetScreenshot(base64Image: string): Promise<any[]> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are an expert at extracting data from images. You will be given a screenshot of a PrizePicks (or similar) betting slip. Extract the bets into a JSON array. Return ONLY valid JSON.",
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Extract the bets from this image. Return a JSON array where each object has: 'playerName' (string), 'line' (number), 'stat' (string - e.g. 'Points', 'Rebs+Asts'), 'side' ('over' or 'under'). If the side is not explicit, assume 'over' (More) if the arrow is green or pointing up, and 'under' (Less) if red or pointing down. If you cannot determine, default to 'over'." },
                        {
                            type: "image_url",
                            image_url: {
                                "url": `data:image/jpeg;base64,${base64Image}`,
                            },
                        },
                    ],
                },
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
        });

        const content = response.choices[0].message.content;
        if (!content) return [];

        const result = JSON.parse(content);
        return result.bets || result.picks || result; // Handle potential variations in JSON structure
    } catch (error) {
        console.error("OpenAI Vision Error:", error);
        throw new Error("Failed to parse screenshot");
    }
}
