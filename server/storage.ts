/**
 * Storage module re-export for backward compatibility
 *
 * This file maintains backward compatibility with existing imports.
 * The actual storage implementation has been moved to ./storage/
 *
 * New code should import directly from "./storage" (the directory)
 * or use specific entity modules like "./storage/player-storage"
 */

export * from "./storage/index";
