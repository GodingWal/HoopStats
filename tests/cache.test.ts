import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCache } from '../server/cache';

describe('MemoryCache', () => {
    let cache: MemoryCache;

    beforeEach(() => {
        cache = new MemoryCache(1000); // 1 second TTL for tests
    });

    describe('get and set', () => {
        it('should store and retrieve values', () => {
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return null for non-existent keys', () => {
            expect(cache.get('nonexistent')).toBeNull();
        });

        it('should store objects', () => {
            const obj = { name: 'test', value: 123 };
            cache.set('obj', obj);
            expect(cache.get('obj')).toEqual(obj);
        });

        it('should store arrays', () => {
            const arr = [1, 2, 3, 'test'];
            cache.set('arr', arr);
            expect(cache.get('arr')).toEqual(arr);
        });
    });

    describe('has', () => {
        it('should return true for existing keys', () => {
            cache.set('key', 'value');
            expect(cache.has('key')).toBe(true);
        });

        it('should return false for non-existent keys', () => {
            expect(cache.has('nonexistent')).toBe(false);
        });
    });

    describe('delete', () => {
        it('should remove a key', () => {
            cache.set('key', 'value');
            expect(cache.delete('key')).toBe(true);
            expect(cache.get('key')).toBeNull();
        });

        it('should return false when deleting non-existent key', () => {
            expect(cache.delete('nonexistent')).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all keys', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.clear();
            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key2')).toBeNull();
        });
    });

    describe('TTL expiration', () => {
        it('should expire entries after TTL', async () => {
            cache.set('key', 'value', 50); // 50ms TTL
            expect(cache.get('key')).toBe('value');

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(cache.get('key')).toBeNull();
        });

        it('should use custom TTL when provided', async () => {
            cache.set('short', 'value', 50);
            cache.set('long', 'value', 500);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(cache.get('short')).toBeNull();
            expect(cache.get('long')).toBe('value');
        });
    });

    describe('stats', () => {
        it('should report correct size', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            const stats = cache.stats();
            expect(stats.size).toBe(2);
            expect(stats.keys).toContain('key1');
            expect(stats.keys).toContain('key2');
        });
    });
});
