
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
