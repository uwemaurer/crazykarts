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
export const MOSS_GRASS = 10;
export const WATER = 11;
export const COAL_ORE = 12;
export const IRON_ORE = 13;
export const GOLD_ORE = 14;
export const POLICE = 15;
export const BARS = 16;
export const BARBED_WIRE = 17;

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
// Moss-grass tile slots. TEX_MOSS_GRASS_TOP is a tag: the shader recognises
// this layer index and resamples the big grass texture with a moss tint, so
// the atlas tile at that layer is never displayed. TEX_MOSS_GRASS_SIDE is a
// regular atlas tile (moss-coloured top edge over dirt).
export const TEX_MOSS_GRASS_TOP = 12;
export const TEX_MOSS_GRASS_SIDE = 13;
export const TEX_WATER_TOP = 14;
export const TEX_WATER_SIDE = 15;
// Ores: stone-base atlas tiles with coloured speckles. All 6 faces share one tile.
export const TEX_COAL_ORE = 16;
export const TEX_IRON_ORE = 17;
export const TEX_GOLD_ORE = 18;
// Police fortress blocks, one tile each shared by all six faces.
//   POLICE       — blue masonry with a white badge motif (walls, towers).
//   BARS         — steel cell bars over a dark interior.
//   BARBED_WIRE  — tangled wire, sits atop the outer battlements.
export const TEX_POLICE = 19;
export const TEX_BARS = 20;
export const TEX_BARBED_WIRE = 21;
export const TEXTURE_LAYER_COUNT = 22;

export interface BlockTextures {
  readonly top: number;
  readonly side: number;
  readonly bottom: number;
}

const STONE_TEX: BlockTextures = { top: TEX_STONE, side: TEX_STONE, bottom: TEX_STONE };

export const BLOCK_TEXTURES: Record<BlockId, BlockTextures> = {
  [GRASS]:      { top: TEX_GRASS_TOP, side: TEX_GRASS_SIDE, bottom: TEX_DIRT },
  [DIRT]:       { top: TEX_DIRT, side: TEX_DIRT, bottom: TEX_DIRT },
  [STONE]:      STONE_TEX,
  [SAND]:       { top: TEX_SAND, side: TEX_SAND, bottom: TEX_SAND },
  [WOOD]:       { top: TEX_WOOD_TOP, side: TEX_WOOD_SIDE, bottom: TEX_WOOD_TOP },
  [LEAVES]:     { top: TEX_LEAVES, side: TEX_LEAVES, bottom: TEX_LEAVES },
  [SNOW]:       { top: TEX_SNOW, side: TEX_SNOW_SIDE, bottom: TEX_DIRT },
  [ROAD]:       { top: TEX_ROAD, side: TEX_ROAD, bottom: TEX_ROAD },
  [ROOF]:       { top: TEX_ROOF, side: TEX_ROOF, bottom: TEX_ROOF },
  [MOSS_GRASS]: { top: TEX_MOSS_GRASS_TOP, side: TEX_MOSS_GRASS_SIDE, bottom: TEX_DIRT },
  [WATER]:      { top: TEX_WATER_TOP, side: TEX_WATER_SIDE, bottom: TEX_WATER_SIDE },
  [COAL_ORE]:   { top: TEX_COAL_ORE, side: TEX_COAL_ORE, bottom: TEX_COAL_ORE },
  [IRON_ORE]:   { top: TEX_IRON_ORE, side: TEX_IRON_ORE, bottom: TEX_IRON_ORE },
  [GOLD_ORE]:   { top: TEX_GOLD_ORE, side: TEX_GOLD_ORE, bottom: TEX_GOLD_ORE },
  [POLICE]:     { top: TEX_POLICE, side: TEX_POLICE, bottom: TEX_POLICE },
  [BARS]:       { top: TEX_BARS, side: TEX_BARS, bottom: TEX_BARS },
  [BARBED_WIRE]:{ top: TEX_BARBED_WIRE, side: TEX_BARBED_WIRE, bottom: TEX_BARBED_WIRE },
};

export function getBlockTextures(block: BlockId): BlockTextures {
  return BLOCK_TEXTURES[block] ?? STONE_TEX;
}

export function isSolid(block: BlockId): boolean {
  return block !== AIR;
}
