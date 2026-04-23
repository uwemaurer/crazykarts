import type { WorldDiffs } from './WorldGenerator';
import type { SerializedInventory } from './Inventory';
import type { BlockId } from './voxel/BlockTypes';

const STORAGE_KEY = 'crazykarts:world:v1';
const SCHEMA_VERSION = 1;

export interface SavedVillage {
  economy: { lumber: number; stone: number; food: number; money: number };
  pending: Array<[number, number, number, BlockId]>; // wx, wy, wz, block
}

export interface SaveData {
  version: number;
  seed: number;
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  inventory: SerializedInventory;
  diffs: WorldDiffs;
  villages: Record<string, SavedVillage>;
}

export const SaveManager = {
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      if (!data || data.version !== SCHEMA_VERSION) return null;
      return data;
    } catch {
      return null;
    }
  },

  save(data: SaveData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('World save failed:', err);
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};
