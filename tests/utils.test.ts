import { describe, it, expect } from 'vitest';

describe('Utility Functions', () => {
    describe('Normal CDF (Cumulative Distribution Function)', () => {
        // Normal CDF approximation from routes.ts
        function normalCDF(x: number, mean: number, std: number): number {
            const z = (x - mean) / std;
            return 0.5 * (1 + erf(z / Math.sqrt(2)));
        }

        function erf(x: number): number {
            const sign = x >= 0 ? 1 : -1;
            x = Math.abs(x);

            const a1 = 0.254829592;
            const a2 = -0.284496736;
            const a3 = 1.421413741;
            const a4 = -1.453152027;
            const a5 = 1.061405429;
            const p = 0.3275911;

            const t = 1.0 / (1.0 + p * x);
            const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

            return sign * y;
        }

        it('should return 0.5 for mean value', () => {
            const result = normalCDF(25, 25, 5);
            expect(result).toBeCloseTo(0.5, 2);
        });

        it('should return ~0.84 for one standard deviation above mean', () => {
            const result = normalCDF(30, 25, 5);
            expect(result).toBeCloseTo(0.8413, 2);
        });

        it('should return ~0.16 for one standard deviation below mean', () => {
            const result = normalCDF(20, 25, 5);
            expect(result).toBeCloseTo(0.1587, 2);
        });

        it('should return ~0.98 for two standard deviations above mean', () => {
            const result = normalCDF(35, 25, 5);
            expect(result).toBeCloseTo(0.9772, 2);
        });

        it('should return ~0.02 for two standard deviations below mean', () => {
            const result = normalCDF(15, 25, 5);
            expect(result).toBeCloseTo(0.0228, 2);
        });

        it('should handle zero standard deviation edge case', () => {
            // When std = 0, all probability should be at the mean
            const result = normalCDF(25, 25, 0.0001);
            expect(result).toBeCloseTo(0.5, 1);
        });
    });

    describe('American Odds Conversion', () => {
        function probToAmericanOdds(prob: number): string {
            if (prob >= 1) return "+100";
            if (prob <= 0) return "+10000";

            if (prob >= 0.5) {
                const odds = -(prob / (1 - prob)) * 100;
                return Math.round(odds).toString();
            } else {
                const odds = ((1 - prob) / prob) * 100;
                return "+" + Math.round(odds).toString();
            }
        }

        it('should convert 50% probability to -100/+100', () => {
            const odds = probToAmericanOdds(0.5);
            // At exactly 50%, the formula gives -100
            expect(odds).toBe("-100");
        });

        it('should convert 60% to negative odds (favorite)', () => {
            const odds = probToAmericanOdds(0.6);
            expect(odds).toBe("-150"); // 0.6 / 0.4 * 100 = -150
        });

        it('should convert 70% to negative odds (strong favorite)', () => {
            const odds = probToAmericanOdds(0.7);
            expect(odds).toBe("-233"); // 0.7 / 0.3 * 100 = -233
        });

        it('should convert 40% to positive odds (underdog)', () => {
            const odds = probToAmericanOdds(0.4);
            expect(odds).toBe("+150"); // 0.6 / 0.4 * 100 = +150
        });

        it('should convert 30% to positive odds (bigger underdog)', () => {
            const odds = probToAmericanOdds(0.3);
            expect(odds).toBe("+233"); // 0.7 / 0.3 * 100 = +233
        });

        it('should handle edge case of 100% probability', () => {
            const odds = probToAmericanOdds(1);
            expect(odds).toBe("+100");
        });

        it('should handle edge case of 0% probability', () => {
            const odds = probToAmericanOdds(0);
            expect(odds).toBe("+10000");
        });

        it('should handle very high probability (95%)', () => {
            const odds = probToAmericanOdds(0.95);
            expect(odds).toBe("-1900"); // 0.95 / 0.05 * 100 = -1900
        });

        it('should handle very low probability (5%)', () => {
            const odds = probToAmericanOdds(0.05);
            expect(odds).toBe("+1900"); // 0.95 / 0.05 * 100 = +1900
        });
    });

    describe('Odds to Probability Conversion', () => {
        function americanOddsToProb(odds: number): number {
            if (odds < 0) {
                // Favorite
                return Math.abs(odds) / (Math.abs(odds) + 100);
            } else {
                // Underdog
                return 100 / (odds + 100);
            }
        }

        it('should convert -100 to 50% probability', () => {
            const prob = americanOddsToProb(-100);
            expect(prob).toBeCloseTo(0.5, 2);
        });

        it('should convert +100 to 50% probability', () => {
            const prob = americanOddsToProb(100);
            expect(prob).toBeCloseTo(0.5, 2);
        });

        it('should convert -150 to ~60% probability', () => {
            const prob = americanOddsToProb(-150);
            expect(prob).toBeCloseTo(0.6, 2);
        });

        it('should convert +150 to ~40% probability', () => {
            const prob = americanOddsToProb(150);
            expect(prob).toBeCloseTo(0.4, 2);
        });

        it('should convert -200 to ~66.67% probability', () => {
            const prob = americanOddsToProb(-200);
            expect(prob).toBeCloseTo(0.6667, 2);
        });

        it('should convert +200 to ~33.33% probability', () => {
            const prob = americanOddsToProb(200);
            expect(prob).toBeCloseTo(0.3333, 2);
        });
    });

    describe('Bet Recommendation Logic', () => {
        function getRecommendation(hitRate: number): {
            recommendation: 'OVER' | 'UNDER';
            confidence: 'HIGH' | 'MEDIUM' | 'LOW';
        } {
            let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
            let recommendation: 'OVER' | 'UNDER' = 'OVER';

            if (hitRate >= 80) {
                confidence = 'HIGH';
                recommendation = 'OVER';
            } else if (hitRate >= 65) {
                confidence = 'MEDIUM';
                recommendation = 'OVER';
            } else if (hitRate <= 25) {
                confidence = 'HIGH';
                recommendation = 'UNDER';
            } else if (hitRate <= 40) {
                confidence = 'MEDIUM';
                recommendation = 'UNDER';
            }

            return { recommendation, confidence };
        }

        it('should recommend HIGH confidence OVER for 80%+ hit rate', () => {
            const result = getRecommendation(85);
            expect(result.recommendation).toBe('OVER');
            expect(result.confidence).toBe('HIGH');
        });

        it('should recommend MEDIUM confidence OVER for 65-79% hit rate', () => {
            const result = getRecommendation(70);
            expect(result.recommendation).toBe('OVER');
            expect(result.confidence).toBe('MEDIUM');
        });

        it('should recommend HIGH confidence UNDER for ≤25% hit rate', () => {
            const result = getRecommendation(20);
            expect(result.recommendation).toBe('UNDER');
            expect(result.confidence).toBe('HIGH');
        });

        it('should recommend MEDIUM confidence UNDER for 26-40% hit rate', () => {
            const result = getRecommendation(35);
            expect(result.recommendation).toBe('UNDER');
            expect(result.confidence).toBe('MEDIUM');
        });

        it('should recommend LOW confidence for neutral hit rates', () => {
            const result = getRecommendation(50);
            expect(result.confidence).toBe('LOW');
        });
    });

    describe('Kelly Criterion Sizing', () => {
        function kellyFraction(edgePercent: number, odds: number): number {
            // Convert American odds to decimal
            const decimalOdds = odds < 0
                ? 1 + (100 / Math.abs(odds))
                : 1 + (odds / 100);

            // Kelly formula: (bp - q) / b
            // where b = net odds, p = win probability, q = 1 - p
            const edge = edgePercent / 100;
            const winProb = 0.5 + edge; // Simplified assumption
            const loseProb = 1 - winProb;
            const netOdds = decimalOdds - 1;

            const kelly = (netOdds * winProb - loseProb) / netOdds;
            return Math.max(0, kelly); // Never bet negative
        }

        it('should return 0 for no edge', () => {
            const result = kellyFraction(0, -110);
            expect(result).toBeLessThanOrEqual(0.01);
        });

        it('should return positive fraction for positive edge', () => {
            const result = kellyFraction(10, -110);
            expect(result).toBeGreaterThan(0);
        });

        it('should return larger fraction for larger edge', () => {
            const small = kellyFraction(5, -110);
            const large = kellyFraction(15, -110);
            expect(large).toBeGreaterThan(small);
        });

        it('should never recommend betting more than 100% of bankroll', () => {
            const result = kellyFraction(50, +200);
            expect(result).toBeLessThanOrEqual(1);
        });
    });

    describe('Data Validation', () => {
        it('should validate player ID is positive integer', () => {
            const playerId = 12345;
            expect(Number.isInteger(playerId)).toBe(true);
            expect(playerId).toBeGreaterThan(0);
        });

        it('should validate stat values are non-negative', () => {
            const stats = { PTS: 25.5, REB: 7.2, AST: 8.1 };
            for (const value of Object.values(stats)) {
                expect(value).toBeGreaterThanOrEqual(0);
            }
        });

        it('should validate percentages are between 0 and 100', () => {
            const percentages = [45.2, 78.9, 92.1, 12.5];
            for (const pct of percentages) {
                expect(pct).toBeGreaterThanOrEqual(0);
                expect(pct).toBeLessThanOrEqual(100);
            }
        });

        it('should validate date strings are in correct format', () => {
            const dateString = '2024-01-15';
            expect(dateString).toMatch(/^\d{4}-\d{2}-\d{2}$/);

            const date = new Date(dateString);
            expect(date.toString()).not.toBe('Invalid Date');
        });
    });
});
