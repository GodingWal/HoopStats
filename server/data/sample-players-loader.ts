/**
 * Sample players data loader
 * Provides a singleton for loading sample player data
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Player } from "@shared/schema";

// Get directory name for ESM compatibility
const getDirname = (): string => {
  try {
    // @ts-ignore
    return __dirname;
  } catch {
    return path.dirname(fileURLToPath(import.meta.url));
  }
};

// Load sample players from JSON file
const currentDir = getDirname();
const samplePlayersPath = path.join(currentDir, "sample-players.json");

export const SAMPLE_PLAYERS: Player[] = JSON.parse(
  readFileSync(samplePlayersPath, "utf-8")
);
