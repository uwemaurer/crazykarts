import type { BlockId } from './voxel/BlockTypes';
import { DIRT, GRASS, LEAVES, ROAD, ROOF, SAND, SNOW, STONE, WOOD } from './voxel/BlockTypes';

export type ToolKind = 'pickaxe' | 'axe';
export type ItemKind = { kind: 'tool'; tool: ToolKind } | { kind: 'block'; block: BlockId };

export interface Slot {
  item: ItemKind;
  count: number;
}

export interface SerializedInventory {
  selected: number;
  slots: Array<
    | { kind: 'tool'; tool: ToolKind; count: number }
    | { kind: 'block'; block: BlockId; count: number }
    | null
  >;
}

const STACK_MAX = 99;
const SLOT_COUNT = 9;

const BLOCK_COLORS: Record<BlockId, string> = {
  [GRASS]:  '#4a8a3a',
  [DIRT]:   '#6e4e30',
  [STONE]:  '#828289',
  [SAND]:   '#dcc88e',
  [WOOD]:   '#643c1c',
  [LEAVES]: '#306e30',
  [SNOW]:   '#eaf0f6',
  [ROAD]:   '#bcbcc4',
  [ROOF]:   '#b63e22',
};

const BLOCK_LABELS: Record<BlockId, string> = {
  [GRASS]:  'Grass',
  [DIRT]:   'Dirt',
  [STONE]:  'Stone',
  [SAND]:   'Sand',
  [WOOD]:   'Wood',
  [LEAVES]: 'Leaves',
  [SNOW]:   'Snow',
  [ROAD]:   'Road',
  [ROOF]:   'Roof',
};

export function blockColor(block: BlockId): string {
  return BLOCK_COLORS[block] ?? '#888';
}

export function blockLabel(block: BlockId): string {
  return BLOCK_LABELS[block] ?? `#${block}`;
}

export class Inventory {
  private slots: (Slot | null)[] = new Array(SLOT_COUNT).fill(null);
  private selected = 0;

  constructor() {
    this.slots[0] = { item: { kind: 'tool', tool: 'pickaxe' }, count: 1 };
    this.slots[1] = { item: { kind: 'tool', tool: 'axe' }, count: 1 };
  }

  public size(): number {
    return SLOT_COUNT;
  }

  public getSlot(i: number): Slot | null {
    return this.slots[i] ?? null;
  }

  public getSelected(): Slot | null {
    return this.slots[this.selected] ?? null;
  }

  public getSelectedIndex(): number {
    return this.selected;
  }

  public selectSlot(i: number): void {
    if (i < 0 || i >= SLOT_COUNT) return;
    this.selected = i;
  }

  public cycle(delta: number): void {
    this.selected = ((this.selected + delta) % SLOT_COUNT + SLOT_COUNT) % SLOT_COUNT;
  }

  public addBlock(block: BlockId, count = 1): number {
    let remaining = count;
    // First, top up existing stacks of this block.
    for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) {
      const s = this.slots[i];
      if (!s || s.item.kind !== 'block' || s.item.block !== block) continue;
      const canAdd = Math.min(remaining, STACK_MAX - s.count);
      s.count += canAdd;
      remaining -= canAdd;
    }
    // Then fill empty slots.
    for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const take = Math.min(remaining, STACK_MAX);
      this.slots[i] = { item: { kind: 'block', block }, count: take };
      remaining -= take;
    }
    return count - remaining;
  }

  public consumeSelectedBlock(): BlockId | null {
    const s = this.slots[this.selected];
    if (!s || s.item.kind !== 'block') return null;
    const block = s.item.block;
    s.count -= 1;
    if (s.count <= 0) this.slots[this.selected] = null;
    return block;
  }

  public consumeBlock(block: BlockId): boolean {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = this.slots[i];
      if (!s || s.item.kind !== 'block' || s.item.block !== block) continue;
      s.count -= 1;
      if (s.count <= 0) this.slots[i] = null;
      return true;
    }
    return false;
  }

  public hasBlock(block: BlockId): boolean {
    for (const s of this.slots) {
      if (s && s.item.kind === 'block' && s.item.block === block) return true;
    }
    return false;
  }

  public serialize(): SerializedInventory {
    return {
      selected: this.selected,
      slots: this.slots.map(s => {
        if (!s) return null;
        if (s.item.kind === 'tool') {
          return { kind: 'tool', tool: s.item.tool, count: s.count };
        }
        return { kind: 'block', block: s.item.block, count: s.count };
      }),
    };
  }

  public load(data: SerializedInventory): void {
    this.selected = Math.max(0, Math.min(SLOT_COUNT - 1, data.selected | 0));
    this.slots = new Array(SLOT_COUNT).fill(null);
    for (let i = 0; i < Math.min(SLOT_COUNT, data.slots.length); i++) {
      const s = data.slots[i];
      if (!s) continue;
      if (s.kind === 'tool') {
        this.slots[i] = { item: { kind: 'tool', tool: s.tool }, count: s.count };
      } else {
        this.slots[i] = { item: { kind: 'block', block: s.block }, count: s.count };
      }
    }
  }
}
