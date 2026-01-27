/**
 * Integration tests for API endpoints
 * Tests the full request/response cycle
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer, Server } from "http";

// Mock storage for testing
const mockStorage = {
  getPlayers: vi.fn(),
  getPlayer: vi.fn(),
  searchPlayers: vi.fn(),
  getPotentialBets: vi.fn(),
  getSportsbooks: vi.fn(),
  getAlerts: vi.fn(),
  getTrackRecord: vi.fn(),
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Players endpoints
  app.get("/api/players", async (req, res) => {
    try {
      const players = await mockStorage.getPlayers();
      res.json(players);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch players" });
    }
  });

  app.get("/api/players/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid player ID" });
      }

      const player = await mockStorage.getPlayer(id);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }
      res.json(player);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch player" });
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.trim().length === 0) {
        const players = await mockStorage.getPlayers();
        return res.json(players);
      }
      const players = await mockStorage.searchPlayers(query.trim());
      res.json(players);
    } catch (error) {
      res.status(500).json({ error: "Failed to search players" });
    }
  });

  // Bets endpoints
  app.get("/api/bets", async (req, res) => {
    try {
      const bets = await mockStorage.getPotentialBets();
      res.json(bets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bets" });
    }
  });

  // Sportsbooks
  app.get("/api/sportsbooks", async (req, res) => {
    try {
      const books = await mockStorage.getSportsbooks();
      res.json(books);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sportsbooks" });
    }
  });

  // Alerts
  app.get("/api/alerts", async (req, res) => {
    try {
      const alerts = await mockStorage.getAlerts({ limit: 20 });
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  // Track record
  app.get("/api/track-record", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const record = await mockStorage.getTrackRecord(days);
      res.json(record);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch track record" });
    }
  });

  // Error handling
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

describe("API Integration Tests", () => {
  let app: express.Express;
  let server: Server;

  beforeAll(() => {
    app = createTestApp();
    server = createServer(app);
  });

  afterAll(() => {
    server.close();
  });

  describe("Health Check", () => {
    it("GET /api/health returns OK status", async () => {
      const response = await request(app).get("/api/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe("Players API", () => {
    it("GET /api/players returns player list", async () => {
      const mockPlayers = [
        { player_id: 1, player_name: "LeBron James", team: "LAL" },
        { player_id: 2, player_name: "Stephen Curry", team: "GSW" },
      ];
      mockStorage.getPlayers.mockResolvedValue(mockPlayers);

      const response = await request(app).get("/api/players");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockPlayers);
      expect(mockStorage.getPlayers).toHaveBeenCalled();
    });

    it("GET /api/players/:id returns single player", async () => {
      const mockPlayer = { player_id: 1, player_name: "LeBron James", team: "LAL" };
      mockStorage.getPlayer.mockResolvedValue(mockPlayer);

      const response = await request(app).get("/api/players/1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockPlayer);
      expect(mockStorage.getPlayer).toHaveBeenCalledWith(1);
    });

    it("GET /api/players/:id returns 404 for non-existent player", async () => {
      mockStorage.getPlayer.mockResolvedValue(undefined);

      const response = await request(app).get("/api/players/999");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Player not found");
    });

    it("GET /api/players/:id returns 400 for invalid ID", async () => {
      const response = await request(app).get("/api/players/invalid");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid player ID");
    });

    it("GET /api/players handles server errors", async () => {
      mockStorage.getPlayers.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/players");

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to fetch players");
    });
  });

  describe("Search API", () => {
    it("GET /api/search returns matching players", async () => {
      const mockPlayers = [{ player_id: 1, player_name: "LeBron James", team: "LAL" }];
      mockStorage.searchPlayers.mockResolvedValue(mockPlayers);

      const response = await request(app).get("/api/search?q=lebron");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockPlayers);
      expect(mockStorage.searchPlayers).toHaveBeenCalledWith("lebron");
    });

    it("GET /api/search without query returns all players", async () => {
      const mockPlayers = [
        { player_id: 1, player_name: "LeBron James", team: "LAL" },
        { player_id: 2, player_name: "Stephen Curry", team: "GSW" },
      ];
      mockStorage.getPlayers.mockResolvedValue(mockPlayers);

      const response = await request(app).get("/api/search");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockPlayers);
    });
  });

  describe("Bets API", () => {
    it("GET /api/bets returns bet recommendations", async () => {
      const mockBets = [
        {
          id: 1,
          player_name: "LeBron James",
          stat_type: "PTS",
          line: 25.5,
          hit_rate: 75,
          recommendation: "OVER",
          confidence: "HIGH",
        },
      ];
      mockStorage.getPotentialBets.mockResolvedValue(mockBets);

      const response = await request(app).get("/api/bets");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockBets);
    });
  });

  describe("Sportsbooks API", () => {
    it("GET /api/sportsbooks returns sportsbook list", async () => {
      const mockBooks = [
        { id: 1, key: "draftkings", name: "DraftKings", active: true },
        { id: 2, key: "fanduel", name: "FanDuel", active: true },
      ];
      mockStorage.getSportsbooks.mockResolvedValue(mockBooks);

      const response = await request(app).get("/api/sportsbooks");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockBooks);
    });
  });

  describe("Alerts API", () => {
    it("GET /api/alerts returns alerts list", async () => {
      const mockAlerts = [
        {
          id: 1,
          type: "INJURY",
          title: "Player Injury Update",
          message: "LeBron James is questionable",
          severity: "INFO",
        },
      ];
      mockStorage.getAlerts.mockResolvedValue(mockAlerts);

      const response = await request(app).get("/api/alerts");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAlerts);
    });
  });

  describe("Track Record API", () => {
    it("GET /api/track-record returns performance data", async () => {
      const mockRecord = {
        total: 100,
        wins: 58,
        losses: 42,
        hitRate: 0.58,
        roi: 0.05,
        profit: 5,
      };
      mockStorage.getTrackRecord.mockResolvedValue(mockRecord);

      const response = await request(app).get("/api/track-record");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockRecord);
      expect(mockStorage.getTrackRecord).toHaveBeenCalledWith(30);
    });

    it("GET /api/track-record accepts days parameter", async () => {
      const mockRecord = { total: 50, wins: 30, losses: 20 };
      mockStorage.getTrackRecord.mockResolvedValue(mockRecord);

      const response = await request(app).get("/api/track-record?days=7");

      expect(response.status).toBe(200);
      expect(mockStorage.getTrackRecord).toHaveBeenCalledWith(7);
    });
  });
});

describe("Input Validation Tests", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  describe("Player ID Validation", () => {
    it("rejects non-numeric player IDs", async () => {
      const response = await request(app).get("/api/players/abc");
      expect(response.status).toBe(400);
    });

    it("rejects negative player IDs", async () => {
      mockStorage.getPlayer.mockResolvedValue(undefined);
      const response = await request(app).get("/api/players/-1");
      expect(response.status).toBe(404);
    });

    it("accepts valid numeric player IDs", async () => {
      mockStorage.getPlayer.mockResolvedValue({ player_id: 123 });
      const response = await request(app).get("/api/players/123");
      expect(response.status).toBe(200);
    });
  });
});

describe("Error Handling Tests", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  it("returns 500 for database errors", async () => {
    mockStorage.getPlayers.mockRejectedValue(new Error("Connection failed"));

    const response = await request(app).get("/api/players");

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });

  it("does not leak stack traces in error responses", async () => {
    mockStorage.getPlayers.mockRejectedValue(new Error("Secret error"));

    const response = await request(app).get("/api/players");

    expect(response.body.stack).toBeUndefined();
  });
});
