import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import express from 'express';

// Mock storage to avoid database dependency in tests
const mockStorage = {
    getPlayers: async () => [],
    getPlayerById: async (id: number) => null,
    searchPlayers: async (query: string) => [],
    getPotentialBets: async () => [],
    getProjections: async () => [],
    getRecommendations: async () => [],
    getTrackRecord: async () => ({ overall: { total: 0, hits: 0, misses: 0, hitRate: 0, roi: 0 }, byStatType: {} }),
    getSportsbooks: async () => [],
    getPlayerPropLines: async (playerId: number) => [],
    getLatestLines: async (playerId: number) => [],
    getLineMovements: async (playerId: number) => [],
    getRecentLineMovements: async () => [],
    getBestLines: async (playerId: number) => [],
    savePotentialBets: async (bets: any[]) => {},
    saveUserBet: async (bet: any) => ({ id: 1, ...bet }),
    getUserBets: async () => [],
};

describe('API Routes', () => {
    let app: Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());

        // Setup basic test routes
        app.get('/api/players', async (req, res) => {
            const players = await mockStorage.getPlayers();
            res.json(players);
        });

        app.get('/api/players/:id', async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'Invalid player ID' });
            }
            const player = await mockStorage.getPlayerById(id);
            if (!player) {
                return res.status(404).json({ error: 'Player not found' });
            }
            res.json(player);
        });

        app.get('/api/bets', async (req, res) => {
            const bets = await mockStorage.getPotentialBets();
            res.json(bets);
        });

        app.get('/api/track-record', async (req, res) => {
            const trackRecord = await mockStorage.getTrackRecord();
            res.json(trackRecord);
        });

        app.get('/api/sportsbooks', async (req, res) => {
            const sportsbooks = await mockStorage.getSportsbooks();
            res.json(sportsbooks);
        });

        app.post('/api/bets/user', async (req, res) => {
            const { player_id, stat_type, line, position } = req.body;

            if (!player_id || !stat_type || !line || !position) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const bet = await mockStorage.saveUserBet(req.body);
            res.status(201).json(bet);
        });

        app.get('/api/bets/user', async (req, res) => {
            const bets = await mockStorage.getUserBets();
            res.json(bets);
        });
    });

    describe('GET /api/players', () => {
        it('should return an array of players', async () => {
            const response = await request(app)
                .get('/api/players')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
        });

        it('should return JSON content type', async () => {
            const response = await request(app)
                .get('/api/players')
                .expect('Content-Type', /json/);

            expect(response.status).toBe(200);
        });
    });

    describe('GET /api/players/:id', () => {
        it('should return 400 for invalid player ID', async () => {
            const response = await request(app)
                .get('/api/players/invalid')
                .expect(400);

            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toBe('Invalid player ID');
        });

        it('should return 404 for non-existent player', async () => {
            const response = await request(app)
                .get('/api/players/999999')
                .expect(404);

            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toBe('Player not found');
        });

        it('should accept numeric player IDs', async () => {
            await request(app)
                .get('/api/players/12345')
                .expect((res) => {
                    expect([200, 404]).toContain(res.status);
                });
        });
    });

    describe('GET /api/bets', () => {
        it('should return an array of potential bets', async () => {
            const response = await request(app)
                .get('/api/bets')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
        });
    });

    describe('GET /api/track-record', () => {
        it('should return track record with overall stats', async () => {
            const response = await request(app)
                .get('/api/track-record')
                .expect(200);

            expect(response.body).toHaveProperty('overall');
            expect(response.body.overall).toHaveProperty('total');
            expect(response.body.overall).toHaveProperty('hits');
            expect(response.body.overall).toHaveProperty('misses');
            expect(response.body.overall).toHaveProperty('hitRate');
        });

        it('should return track record with byStatType breakdown', async () => {
            const response = await request(app)
                .get('/api/track-record')
                .expect(200);

            expect(response.body).toHaveProperty('byStatType');
            expect(typeof response.body.byStatType).toBe('object');
        });
    });

    describe('GET /api/sportsbooks', () => {
        it('should return an array of sportsbooks', async () => {
            const response = await request(app)
                .get('/api/sportsbooks')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
        });
    });

    describe('POST /api/bets/user', () => {
        it('should create a user bet with valid data', async () => {
            const betData = {
                player_id: 12345,
                player_name: 'Test Player',
                team: 'LAL',
                stat_type: 'PTS',
                line: 25.5,
                position: 'OVER',
                odds: -110,
                stake: 100
            };

            const response = await request(app)
                .post('/api/bets/user')
                .send(betData)
                .expect(201);

            expect(response.body).toHaveProperty('id');
            expect(response.body.player_id).toBe(betData.player_id);
        });

        it('should return 400 when missing required fields', async () => {
            const invalidBet = {
                player_id: 12345,
                // missing stat_type, line, position
            };

            const response = await request(app)
                .post('/api/bets/user')
                .send(invalidBet)
                .expect(400);

            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toBe('Missing required fields');
        });

        it('should return 400 when missing player_id', async () => {
            const invalidBet = {
                stat_type: 'PTS',
                line: 25.5,
                position: 'OVER'
            };

            await request(app)
                .post('/api/bets/user')
                .send(invalidBet)
                .expect(400);
        });

        it('should return 400 when missing stat_type', async () => {
            const invalidBet = {
                player_id: 12345,
                line: 25.5,
                position: 'OVER'
            };

            await request(app)
                .post('/api/bets/user')
                .send(invalidBet)
                .expect(400);
        });

        it('should return 400 when missing line', async () => {
            const invalidBet = {
                player_id: 12345,
                stat_type: 'PTS',
                position: 'OVER'
            };

            await request(app)
                .post('/api/bets/user')
                .send(invalidBet)
                .expect(400);
        });

        it('should return 400 when missing position', async () => {
            const invalidBet = {
                player_id: 12345,
                stat_type: 'PTS',
                line: 25.5
            };

            await request(app)
                .post('/api/bets/user')
                .send(invalidBet)
                .expect(400);
        });
    });

    describe('GET /api/bets/user', () => {
        it('should return an array of user bets', async () => {
            const response = await request(app)
                .get('/api/bets/user')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should handle malformed JSON', async () => {
            await request(app)
                .post('/api/bets/user')
                .set('Content-Type', 'application/json')
                .send('{ invalid json }')
                .expect(400);
        });

        it('should return 404 for non-existent routes', async () => {
            await request(app)
                .get('/api/nonexistent')
                .expect(404);
        });
    });
});
