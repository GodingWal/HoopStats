/**
 * OpenAPI/Swagger API Documentation
 */

import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Courtside Edge API",
      version: "1.0.0",
      description: "NBA Props Betting Analytics Platform API",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Development server",
      },
    ],
    tags: [
      { name: "Players", description: "Player data operations" },
      { name: "Bets", description: "Betting recommendations" },
      { name: "Injuries", description: "Injury tracking" },
      { name: "Lines", description: "Line tracking and comparison" },
      { name: "Parlays", description: "Parlay management" },
      { name: "Odds", description: "Odds API integration" },
      { name: "Teams", description: "Team statistics" },
      { name: "PrizePicks", description: "PrizePicks integration" },
    ],
    components: {
      schemas: {
        Player: {
          type: "object",
          properties: {
            player_id: { type: "integer", description: "Unique player ID" },
            player_name: { type: "string", description: "Player full name" },
            team: { type: "string", description: "Team abbreviation" },
            team_id: { type: "integer", description: "Team ID" },
            games_played: { type: "integer", description: "Games played this season" },
            season_averages: {
              type: "object",
              properties: {
                PTS: { type: "number" },
                REB: { type: "number" },
                AST: { type: "number" },
                FG3M: { type: "number" },
                MIN: { type: "number" },
              },
            },
            hit_rates: {
              type: "object",
              description: "Hit rates for different lines",
            },
            injury_status: {
              type: "object",
              nullable: true,
              properties: {
                status: { type: "string" },
                description: { type: "string" },
                isOut: { type: "boolean" },
              },
            },
          },
        },
        PotentialBet: {
          type: "object",
          properties: {
            id: { type: "integer" },
            player_id: { type: "integer" },
            player_name: { type: "string" },
            team: { type: "string" },
            stat_type: { type: "string", enum: ["PTS", "REB", "AST", "PRA", "FG3M"] },
            line: { type: "number" },
            hit_rate: { type: "number" },
            season_avg: { type: "number" },
            last_5_avg: { type: "number", nullable: true },
            recommendation: { type: "string", enum: ["OVER", "UNDER"] },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            edge_type: { type: "string", nullable: true },
            edge_score: { type: "number", nullable: true },
            edge_description: { type: "string", nullable: true },
          },
        },
        TrackRecord: {
          type: "object",
          properties: {
            total: { type: "integer", description: "Total bets tracked" },
            wins: { type: "integer", description: "Winning bets" },
            losses: { type: "integer", description: "Losing bets" },
            hitRate: { type: "number", description: "Win percentage" },
            roi: { type: "number", description: "Return on investment" },
            profit: { type: "number", description: "Total units profit" },
            byConfidence: {
              type: "object",
              properties: {
                high: { $ref: "#/components/schemas/ConfidenceStats" },
                medium: { $ref: "#/components/schemas/ConfidenceStats" },
                low: { $ref: "#/components/schemas/ConfidenceStats" },
              },
            },
          },
        },
        ConfidenceStats: {
          type: "object",
          properties: {
            wins: { type: "integer" },
            total: { type: "integer" },
            hitRate: { type: "number" },
          },
        },
        Injury: {
          type: "object",
          properties: {
            playerId: { type: "integer" },
            playerName: { type: "string" },
            team: { type: "string" },
            status: { type: "string", enum: ["out", "doubtful", "questionable", "probable"] },
            injuryType: { type: "string" },
            description: { type: "string" },
          },
        },
        Alert: {
          type: "object",
          properties: {
            id: { type: "integer" },
            type: { type: "string" },
            title: { type: "string" },
            message: { type: "string" },
            severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] },
            read: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string", description: "Error message" },
            details: { type: "object", description: "Additional error details" },
          },
        },
      },
    },
    paths: {
      "/api/health": {
        get: {
          summary: "Health check",
          description: "Check if the API is running",
          responses: {
            200: {
              description: "API is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      timestamp: { type: "string", format: "date-time" },
                      uptime: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/players": {
        get: {
          tags: ["Players"],
          summary: "Get all players",
          description: "Retrieve all NBA players with their stats and injury status",
          responses: {
            200: {
              description: "List of players",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Player" },
                  },
                },
              },
            },
            500: {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/players/{id}": {
        get: {
          tags: ["Players"],
          summary: "Get player by ID",
          description: "Retrieve a specific player's data",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Player ID",
              schema: { type: "integer" },
            },
          ],
          responses: {
            200: {
              description: "Player data",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Player" },
                },
              },
            },
            400: { description: "Invalid player ID" },
            404: { description: "Player not found" },
          },
        },
      },
      "/api/search": {
        get: {
          tags: ["Players"],
          summary: "Search players",
          description: "Search players by name or team",
          parameters: [
            {
              name: "q",
              in: "query",
              description: "Search query",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Matching players",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Player" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/bets": {
        get: {
          tags: ["Bets"],
          summary: "Get betting recommendations",
          description: "Get filtered and sorted betting recommendations",
          responses: {
            200: {
              description: "List of betting recommendations",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PotentialBet" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/bets/refresh": {
        post: {
          tags: ["Bets"],
          summary: "Refresh betting recommendations",
          description: "Regenerate betting recommendations from PrizePicks data",
          responses: {
            200: {
              description: "Refresh successful",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      betsCount: { type: "integer" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/track-record": {
        get: {
          tags: ["Bets"],
          summary: "Get track record",
          description: "Get historical performance metrics",
          parameters: [
            {
              name: "days",
              in: "query",
              description: "Number of days to look back (default: 30)",
              schema: { type: "integer", default: 30 },
            },
          ],
          responses: {
            200: {
              description: "Track record data",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TrackRecord" },
                },
              },
            },
          },
        },
      },
      "/api/injuries/today": {
        get: {
          tags: ["Injuries"],
          summary: "Get today's injuries",
          description: "Get all player injuries for today's games",
          responses: {
            200: {
              description: "List of injuries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      injuries: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Injury" },
                      },
                      count: { type: "integer" },
                      fetchedAt: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/injuries/team/{teamAbbr}": {
        get: {
          tags: ["Injuries"],
          summary: "Get team injuries",
          description: "Get injuries for a specific team",
          parameters: [
            {
              name: "teamAbbr",
              in: "path",
              required: true,
              description: "Team abbreviation (e.g., LAL, GSW)",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Team injuries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      team: { type: "string" },
                      injuries: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Injury" },
                      },
                      count: { type: "integer" },
                      outPlayers: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/alerts": {
        get: {
          tags: ["Alerts"],
          summary: "Get alerts",
          description: "Get system alerts and notifications",
          responses: {
            200: {
              description: "List of alerts",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Alert" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/live-games": {
        get: {
          tags: ["Games"],
          summary: "Get live games",
          description: "Get today's NBA games with odds",
          parameters: [
            {
              name: "date",
              in: "query",
              description: "Date in YYYYMMDD format (optional)",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "List of games",
            },
          },
        },
      },
      "/api/prizepicks/projections": {
        get: {
          tags: ["PrizePicks"],
          summary: "Get PrizePicks projections",
          description: "Get current player props from PrizePicks",
          responses: {
            200: {
              description: "List of projections",
            },
          },
        },
      },
    },
  },
  apis: [], // We're defining everything inline above
};

const specs = swaggerJsdoc(options);

export function setupApiDocs(app: Express): void {
  // Serve Swagger UI at /api-docs
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs, {
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin-bottom: 20px; }
    `,
    customSiteTitle: "Courtside Edge API Documentation",
  }));

  // Serve raw OpenAPI spec
  app.get("/api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(specs);
  });
}

export { specs };
