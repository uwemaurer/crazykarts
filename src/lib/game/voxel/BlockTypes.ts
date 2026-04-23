export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const WOOD = 5;
export const LEAVES = 6;
export const SNOW = 7;
export const ROAD = 8;
export const ROOF = 9;

export type BlockId = number;

export const TEX_GRASS_TOP = 0;
export const TEX_GRASS_SIDE = 1;
export const TEX_DIRT = 2;
export const TEX_STONE = 3;
export const TEX_SAND = 4;
export const TEX_WOOD_TOP = 5;
export const TEX_WOOD_SIDE = 6;
export const TEX_LEAVES = 7;
export const TEX_SNOW = 8;
export const TEX_SNOW_SIDE = 9;
export const TEX_ROAD = 10;
export const TEX_ROOF = 11;
export const TEXTURE_LAYER_COUNT = 12;

export interface BlockTextures {
  readonly top: number;
  readonly side: number;
  readonly bottom: number;
}

const STONE_TEX: BlockTextures = { top: TEX_STONE, side: TEX_STONE, bottom: TEX_STONE };

export const BLOCK_TEXTURES: Record<BlockId, BlockTextures> = {
  [GRASS]:  { top: TEX_GRASS_TOP, side: TEX_GRASS_SIDE, bottom: TEX_DIRT },
  [DIRT]:   { top: TEX_DIRT, side: TEX_DIRT, bottom: TEX_DIRT },
  [STONE]:  STONE_TEX,
  [SAND]:   { top: TEX_SAND, side: TEX_SAND, bottom: TEX_SAND },
  [WOOD]:   { top: TEX_WOOD_TOP, side: TEX_WOOD_SIDE, bottom: TEX_WOOD_TOP },
  [LEAVES]: { top: TEX_LEAVES, side: TEX_LEAVES, bottom: TEX_LEAVES },
  [SNOW]:   { top: TEX_SNOW, side: TEX_SNOW_SIDE, bottom: TEX_DIRT },
  [ROAD]:   { top: TEX_ROAD, side: TEX_ROAD, bottom: TEX_ROAD },
  [ROOF]:   { top: TEX_ROOF, side: TEX_ROOF, bottom: TEX_ROOF },
};

export function getBlockTextures(block: BlockId): BlockTextures {
  return BLOCK_TEXTURES[block] ?? STONE_TEX;
}

export function isSolid(block: BlockId): boolean {
  return block !== AIR;
}
