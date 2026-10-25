import * as THREE from 'three';
import { createNoise4D } from 'simplex-noise';
import {
  TEX_BARBED_WIRE,
  TEX_BARS,
  TEX_COAL_ORE,
  TEX_DIRT,
  TEX_GOLD_ORE,
  TEX_GRASS_SIDE,
  TEX_GRASS_TOP,
  TEX_IRON_ORE,
  TEX_LEAVES,
  TEX_MOSS_GRASS_SIDE,
  TEX_MOSS_GRASS_TOP,
  TEX_POLICE,
  TEX_ROAD,
  TEX_ROOF,
  TEX_SAND,
  TEX_SNOW,
  TEX_SNOW_SIDE,
  TEX_STONE,
  TEX_WATER_SIDE,
  TEX_WATER_TOP,
  TEX_WOOD_SIDE,
  TEX_WOOD_TOP,
  TEXTURE_LAYER_COUNT,
} from './BlockTypes';

const TILE_SIZE = 16;
const TILE_PIXELS = TILE_SIZE * TILE_SIZE;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.floor(v * 255)));
}

function setPixel(data: Uint8Array, layer: number, x: number, y: number, r: number, g: number, b: number) {
  const idx = (layer * TILE_PIXELS + y * TILE_SIZE + x) * 4;
  data[idx] = clamp255(r);
  data[idx + 1] = clamp255(g);
  data[idx + 2] = clamp255(b);
  data[idx + 3] = 255;
}

function generateGrassTop(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 101);
      let r = 0.30;
      let g = 0.60;
      let b = 0.22;
      if (n > 0.92) { r *= 0.7; g *= 0.7; b *= 0.7; }
      else if (n > 0.7) { r *= 1.15; g *= 1.12; b *= 1.1; }
      else { const s = 0.9 + n * 0.2; r *= s; g *= s; b *= s; }
      setPixel(data, TEX_GRASS_TOP, x, y, r, g, b);
    }
  }
}

// Tag-only fallback tile: the shader intercepts this layer and resamples the
// big grass texture with a moss tint, so this atlas tile is never displayed
// under normal conditions. Kept reasonable as a safety net.
function generateMossGrassTop(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 131);
      const shade = 0.88 + n * 0.2;
      setPixel(data, TEX_MOSS_GRASS_TOP, x, y, 0.18 * shade, 0.46 * shade, 0.24 * shade);
    }
  }
}

function generateMossGrassSide(data: Uint8Array) {
  for (let x = 0; x < TILE_SIZE; x++) {
    const edge = 3 + Math.floor(hash(x, 0, 212) * 3);
    for (let y = 0; y < TILE_SIZE; y++) {
      const n = hash(x, y, 213);
      const shade = 0.88 + n * 0.22;
      if (y < edge) {
        setPixel(data, TEX_MOSS_GRASS_SIDE, x, y, 0.18 * shade, 0.46 * shade, 0.24 * shade);
      } else {
        setPixel(data, TEX_MOSS_GRASS_SIDE, x, y, 0.50 * shade, 0.35 * shade, 0.20 * shade);
      }
    }
  }
}

// Water tiles. Kept low-contrast so the animated UV scroll in the shader
// supplies most of the visual motion; a busy static texture would fight it.
function generateWaterTop(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 2001);
      // Two-octave softened noise for gentle streaks.
      const streak = Math.sin((x + y * 0.3) * 0.9) * 0.5 + 0.5;
      const shade = 0.88 + n * 0.12 + streak * 0.08;
      setPixel(data, TEX_WATER_TOP, x, y, 0.22 * shade, 0.42 * shade, 0.72 * shade);
    }
  }
}

function generateWaterSide(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 2101);
      const shade = 0.85 + n * 0.2;
      setPixel(data, TEX_WATER_SIDE, x, y, 0.18 * shade, 0.36 * shade, 0.64 * shade);
    }
  }
}

function generateGrassSide(data: Uint8Array) {
  for (let x = 0; x < TILE_SIZE; x++) {
    const edge = 3 + Math.floor(hash(x, 0, 202) * 3);
    for (let y = 0; y < TILE_SIZE; y++) {
      const n = hash(x, y, 203);
      const shade = 0.88 + n * 0.22;
      if (y < edge) {
        setPixel(data, TEX_GRASS_SIDE, x, y, 0.30 * shade, 0.60 * shade, 0.22 * shade);
      } else {
        setPixel(data, TEX_GRASS_SIDE, x, y, 0.50 * shade, 0.35 * shade, 0.20 * shade);
      }
    }
  }
}

function generateDirt(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 304);
      const shade = 0.82 + n * 0.32;
      let r = 0.50 * shade;
      let g = 0.35 * shade;
      let b = 0.20 * shade;
      if (hash(x, y, 305) > 0.92) { r *= 0.7; g *= 0.7; b *= 0.7; }
      setPixel(data, TEX_DIRT, x, y, r, g, b);
    }
  }
}

function generateStone(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 406);
      let shade;
      if (n < 0.08) shade = 0.62;
      else if (n > 0.94) shade = 1.08;
      else shade = 0.88 + n * 0.2;
      setPixel(data, TEX_STONE, x, y, 0.5 * shade, 0.5 * shade, 0.52 * shade);
    }
  }
}

// Stone-base + speckles for ore tiles. The speckle hash uses a per-ore seed
// so coal/iron/gold land in different pixels even though they share the
// stone substrate. `oreDensity` is the fraction of pixels that become a
// speckle; the rest sample the regular stone palette.
function generateOreTile(data: Uint8Array, layer: number, seed: number, oreColor: [number, number, number], oreDensity: number) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const oreHash = hash(x, y, seed);
      if (oreHash < oreDensity) {
        // Vary the speckle brightness slightly so it doesn't look stamped.
        const v = 0.78 + hash(x, y, seed + 1) * 0.32;
        setPixel(data, layer, x, y, oreColor[0] * v, oreColor[1] * v, oreColor[2] * v);
      } else {
        // Stone base — same palette as generateStone.
        const n = hash(x, y, 406);
        const shade = n < 0.08 ? 0.62 : n > 0.94 ? 1.08 : 0.88 + n * 0.2;
        setPixel(data, layer, x, y, 0.5 * shade, 0.5 * shade, 0.52 * shade);
      }
    }
  }
}

function generateCoalOre(data: Uint8Array) {
  generateOreTile(data, TEX_COAL_ORE, 1601, [0.10, 0.10, 0.12], 0.20);
}

function generateIronOre(data: Uint8Array) {
  generateOreTile(data, TEX_IRON_ORE, 1701, [0.78, 0.55, 0.32], 0.15);
}

function generateGoldOre(data: Uint8Array) {
  generateOreTile(data, TEX_GOLD_ORE, 1801, [1.00, 0.82, 0.20], 0.13);
}

function generateSand(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 507);
      const shade = 0.93 + n * 0.14;
      setPixel(data, TEX_SAND, x, y, 0.88 * shade, 0.80 * shade, 0.52 * shade);
    }
  }
}

function generateWoodTop(data: Uint8Array) {
  const cx = (TILE_SIZE - 1) / 2;
  const cy = (TILE_SIZE - 1) / 2;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(dist * 1.1) * 0.5 + 0.5;
      const n = hash(x, y, 608) * 0.12;
      const shade = 0.72 + ring * 0.28 + n;
      setPixel(data, TEX_WOOD_TOP, x, y, 0.50 * shade, 0.32 * shade, 0.16 * shade);
    }
  }
}

function generateWoodSide(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const stripe = Math.sin(x * 1.3 + hash(x, 0, 709) * 2) * 0.5 + 0.5;
      const n = hash(x, y, 710) * 0.18;
      const shade = 0.72 + stripe * 0.24 + n;
      setPixel(data, TEX_WOOD_SIDE, x, y, 0.42 * shade, 0.28 * shade, 0.14 * shade);
    }
  }
}

function generateLeaves(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 811);
      let shade: number;
      if (n < 0.25) shade = 0.65;
      else if (n < 0.55) shade = 0.9;
      else if (n < 0.85) shade = 1.05;
      else shade = 1.2;
      setPixel(data, TEX_LEAVES, x, y, 0.22 * shade, 0.50 * shade, 0.22 * shade);
    }
  }
}

function generateSnow(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 912);
      const shade = 0.93 + n * 0.07;
      setPixel(data, TEX_SNOW, x, y, 0.96 * shade, 0.98 * shade, 1.0 * shade);
    }
  }
}

function generateSnowSide(data: Uint8Array) {
  for (let x = 0; x < TILE_SIZE; x++) {
    const snowLine = 4 + Math.floor(hash(x, 0, 1013) * 3);
    for (let y = 0; y < TILE_SIZE; y++) {
      const n = hash(x, y, 1014);
      if (y < snowLine) {
        const shade = 0.93 + n * 0.07;
        setPixel(data, TEX_SNOW_SIDE, x, y, 0.96 * shade, 0.98 * shade, 1.0 * shade);
      } else {
        const shade = 0.85 + n * 0.25;
        setPixel(data, TEX_SNOW_SIDE, x, y, 0.50 * shade, 0.35 * shade, 0.20 * shade);
      }
    }
  }
}

function generateRoad(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const cellX = x >> 2;
      const cellY = y >> 2;
      const offsetY = (cellX & 1) * 2;
      const rowY = (y + offsetY) >> 2;
      const stone = (hash(cellX, rowY, 1115) * 1000) | 0;
      const base = 0.42 + (stone & 15) / 100;
      const edge = (x & 3) === 0 || ((y + offsetY) & 3) === 0 ? 0.72 : 1.0;
      const n = hash(x, y, 1116);
      const shade = base * edge * (0.92 + n * 0.14);
      setPixel(data, TEX_ROAD, x, y, 0.95 * shade, 0.95 * shade, 0.97 * shade);
    }
  }
}

function generateRoof(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 1218);
      const row = (y >> 1) & 1;
      const scallop = Math.sin((x + row * 2) * 1.6) * 0.5 + 0.5;
      const stripe = (y & 3) === 0 ? 0.55 : 1.0;
      const shade = (0.78 + scallop * 0.28 + n * 0.12) * stripe;
      setPixel(data, TEX_ROOF, x, y, 0.78 * shade, 0.26 * shade, 0.18 * shade);
    }
  }
}

// Police station block: police-blue masonry with a faint block grid and a
// white diamond badge (with a blue pip) in the tile centre. One tile, all
// six faces — the station's walls, flat roof and beacon all use it.
function generatePolice(data: Uint8Array) {
  const cx = 7.5;
  const cy = 7.5;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 1901);
      const grid = x % 8 === 0 || y % 8 === 0 ? 0.80 : 1.0;
      const shade = (0.90 + n * 0.18) * grid;
      let r = 0.16 * shade;
      let g = 0.24 * shade;
      let b = 0.58 * shade;
      const dia = Math.abs(x - cx) + Math.abs(y - cy);
      if (dia <= 4.5) {
        const w = 0.92 + n * 0.12;
        r = 0.95 * w;
        g = 0.96 * w;
        b = 0.98 * w;
        if (dia <= 1.5) { r = 0.18; g = 0.30; b = 0.70; }
      }
      setPixel(data, TEX_POLICE, x, y, r, g, b);
    }
  }
}

// Cell bars: dark steel interior with bright vertical bars and a couple of
// horizontal cross-rails. One tile, all six faces — used for the front of
// every jail cell in the fortress.
function generateBars(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 2201);
      // Dark gap behind the bars.
      let r = 0.10 * (0.8 + n * 0.4);
      let g = 0.10 * (0.8 + n * 0.4);
      let b = 0.12 * (0.8 + n * 0.4);
      const onBar = x % 5 === 1 || x % 5 === 2;
      const onRail = y === 2 || y === 13;
      if (onBar || onRail) {
        const s = 0.62 + n * 0.35;
        r = 0.58 * s;
        g = 0.60 * s;
        b = 0.66 * s;
      }
      setPixel(data, TEX_BARS, x, y, r, g, b);
    }
  }
}

// Barbed wire: a dark base crossed by two diagonal wire strands with the odd
// bright barb. Sits as a single layer on top of the outer battlements.
function generateBarbedWire(data: Uint8Array) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = hash(x, y, 2301);
      let r = 0.09 * (0.8 + n * 0.5);
      let g = 0.10 * (0.8 + n * 0.5);
      let b = 0.11 * (0.8 + n * 0.5);
      const strandA = (x + y) % 6 < 1;
      const strandB = (x - y + TILE_SIZE) % 6 < 1;
      if (strandA || strandB) {
        const s = 0.55 + n * 0.4;
        r = 0.52 * s;
        g = 0.52 * s;
        b = 0.55 * s;
      }
      // Barbs: bright specks where the two strands nearly cross.
      if (strandA && strandB || hash(x, y, 2302) > 0.95) {
        r = 0.85; g = 0.85; b = 0.9;
      }
      setPixel(data, TEX_BARBED_WIRE, x, y, r, g, b);
    }
  }
}

let cachedBlockData: Uint8Array | null = null;

function getBlockData(): Uint8Array {
  if (!cachedBlockData) {
    const data = new Uint8Array(TEXTURE_LAYER_COUNT * TILE_PIXELS * 4);
    generateGrassTop(data);
    generateGrassSide(data);
    generateMossGrassTop(data);
    generateMossGrassSide(data);
    generateWaterTop(data);
    generateWaterSide(data);
    generateDirt(data);
    generateStone(data);
    generateSand(data);
    generateWoodTop(data);
    generateWoodSide(data);
    generateLeaves(data);
    generateSnow(data);
    generateSnowSide(data);
    generateRoad(data);
    generateRoof(data);
    generateCoalOre(data);
    generateIronOre(data);
    generateGoldOre(data);
    generatePolice(data);
    generateBars(data);
    generateBarbedWire(data);
    cachedBlockData = data;
  }
  return cachedBlockData;
}

export function createBlockTextureArray(renderer?: THREE.WebGLRenderer): THREE.DataArrayTexture {
  const data = getBlockData();
  const texture = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, TEXTURE_LAYER_COUNT);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  // Nearest magnification keeps the pixel-art look up close; mipmapped min
  // filter stops distant tiles from shimmering. Mips for the tile atlas only
  // stay seam-free when fragments sample via unwrapped UV derivatives — the
  // chunk shader uses textureGrad(fract(uv), dFdx(uv), dFdy(uv)) for that.
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = true;
  if (renderer) texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const tileCanvasCache = new Map<number, HTMLCanvasElement>();
export function getTileCanvas(layer: number): HTMLCanvasElement {
  const cached = tileCanvasCache.get(layer);
  if (cached) return cached;
  const data = getBlockData();
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const offset = layer * TILE_PIXELS * 4;
  imgData.data.set(data.subarray(offset, offset + TILE_PIXELS * 4));
  ctx.putImageData(imgData, 0, 0);
  tileCanvasCache.set(layer, canvas);
  return canvas;
}

const tileDataUrlCache = new Map<number, string>();
export function getTileDataUrl(layer: number): string {
  const cached = tileDataUrlCache.get(layer);
  if (cached) return cached;
  const url = getTileCanvas(layer).toDataURL();
  tileDataUrlCache.set(layer, url);
  return url;
}

const tileTextureCache = new Map<number, THREE.CanvasTexture>();
export function getTileTexture(layer: number): THREE.CanvasTexture {
  const cached = tileTextureCache.get(layer);
  if (cached) return cached;
  const tex = new THREE.CanvasTexture(getTileCanvas(layer));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tileTextureCache.set(layer, tex);
  return tex;
}

// Large tileable grass-top texture. 256x256 pixels = 16x16 sub-tiles of 16
// pixels each, so every 16 world blocks the pattern wraps once. Broken into
// low-freq patches (tileable 4D simplex sampled on a torus) for coherent
// hue/brightness variation, plus the existing per-pixel noise for fine grain.
const GRASS_TOP_LARGE_SIZE = 256;
let cachedGrassTopLargeData: Uint8Array | null = null;

function getGrassTopLargeData(): Uint8Array {
  if (cachedGrassTopLargeData) return cachedGrassTopLargeData;
  const W = GRASS_TOP_LARGE_SIZE;
  const data = new Uint8Array(W * W * 4);
  // Deterministic seed so rebuilds look identical.
  let s = 0x9e3779b9 >>> 0;
  const rng = () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
  };
  const noisePatch = createNoise4D(rng);
  const noiseDetail = createNoise4D(rng);
  // 4D sampling on a 2D torus (cos/sin remap) gives seamlessly tileable noise
  // in 2D — needed so the texture wraps at 256 without a visible seam.
  const TAU = Math.PI * 2;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / W;
      const cx = Math.cos(u * TAU);
      const sx = Math.sin(u * TAU);
      const cy = Math.cos(v * TAU);
      const sy = Math.sin(v * TAU);
      // Low-freq patches: big soft shading islands across the whole 16×16 region.
      const patch = noisePatch(cx, sx, cy, sy); // [-1, 1]
      // Mid-freq detail: few-block-sized variation.
      const det = noiseDetail(cx * 3.0, sx * 3.0, cy * 3.0, sy * 3.0);
      // Per-pixel noise is inherently seamless (pure hash, no neighbour correlation).
      const n = hash(x, y, 101);

      let r = 0.30;
      let g = 0.60;
      let b = 0.22;

      const shade = 0.78 + (patch * 0.5 + 0.5) * 0.30 + (det * 0.5 + 0.5) * 0.14;
      r *= shade; g *= shade; b *= shade;
      // Slight hue drift: dryer (toward yellow) where patch is positive, cooler (toward blue-green) where negative.
      const hue = patch * 0.06;
      r += hue * 0.05;
      g += hue * 0.02;
      b -= hue * 0.05;

      if (n > 0.92) { r *= 0.70; g *= 0.70; b *= 0.70; }
      else if (n > 0.70) { r *= 1.15; g *= 1.12; b *= 1.10; }
      else { const s2 = 0.92 + n * 0.16; r *= s2; g *= s2; b *= s2; }

      const idx = (y * W + x) * 4;
      data[idx] = clamp255(r);
      data[idx + 1] = clamp255(g);
      data[idx + 2] = clamp255(b);
      data[idx + 3] = 255;
    }
  }
  cachedGrassTopLargeData = data;
  return data;
}

// CPU-side luminance lookup into the same 256×256 grass-top data the shader
// samples. GrassSystem uses this to rejection-sample blade positions so
// clumps of blades line up with dark patches in the texture (more blades
// where the ground already looks mossy, fewer in light/dry patches).
export function sampleGrassTopLuminance(worldX: number, worldZ: number): number {
  const data = getGrassTopLargeData();
  const W = GRASS_TOP_LARGE_SIZE;
  // Positive mod so negative world coordinates wrap correctly.
  const wx = ((worldX * (W / 16)) % W + W) % W;
  const wz = ((worldZ * (W / 16)) % W + W) % W;
  const px = Math.floor(wx);
  const py = Math.floor(wz);
  const idx = (py * W + px) * 4;
  // Rec. 709 luminance weights.
  return (0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2]) / 255;
}

export function createGrassTopTexture(renderer?: THREE.WebGLRenderer): THREE.DataTexture {
  const tex = new THREE.DataTexture(getGrassTopLargeData(), GRASS_TOP_LARGE_SIZE, GRASS_TOP_LARGE_SIZE);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

/** Shared per-frame uniforms reused across both LOD-tier materials so a
 *  single update from Game.ts moves both meshes in lockstep. */
export interface ChunkSharedUniforms {
  uTime: { value: number };
  uCameraXZ: { value: THREE.Vector2 };
  uFadeStart: { value: number };
  uFadeEnd: { value: number };
  // Bit flags for debug visualisation:
  //   bit 0 (1) — disable LOD0 dither discard (render everything fully).
  //   bit 1 (2) — visualise fadeT as a red/blue gradient on the surface
  //               instead of normal albedo. Lets you see exactly where
  //               the fade engages in world space.
  uDebugMode: { value: number };
}

export interface ChunkMaterial extends THREE.MeshLambertMaterial {
  uniformsShared: ChunkSharedUniforms;
}

export function createChunkSharedUniforms(): ChunkSharedUniforms {
  return {
    uTime: { value: 0 },
    uCameraXZ: { value: new THREE.Vector2() },
    uFadeStart: { value: 1e9 },
    uFadeEnd: { value: 1e9 + 1 },
    uDebugMode: { value: 0 },
  };
}

export function createChunkMaterial(
  texture: THREE.DataArrayTexture,
  grassTopTexture: THREE.DataTexture,
  // 0 = near (full LOD): fades OUT past uFadeStart.
  // 1 = far (LOD1): fades IN past uFadeStart, opaque past uFadeEnd.
  // Pixels in the transition band are ditcher-discarded so the two LODs
  // alpha-blend in screen space without needing transparency sorting.
  lodLevel: 0 | 1 = 0,
  sharedUniforms?: ChunkSharedUniforms,
): ChunkMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true }) as ChunkMaterial;
  const uniforms = sharedUniforms ?? createChunkSharedUniforms();
  material.uniformsShared = uniforms;
  // LOD0 alpha-blends with LOD1 in the fade band (`diffuseColor.a` is set
  // to 1 - fadeT in the fragment shader). Three.js needs `transparent` to
  // route the material through the transparent pass; depthWrite stays
  // off (the default for transparent) so closer transparent fragments
  // don't occlude further ones.
  if (lodLevel === 0) {
    material.transparent = true;
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.tAtlas = { value: texture };
    shader.uniforms.tGrassTop = { value: grassTopTexture };
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCameraXZ = uniforms.uCameraXZ;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;
    shader.uniforms.uDebugMode = uniforms.uDebugMode;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aLayer;
attribute vec2 aFlow;
attribute float aWaterTile;
attribute float aSkyLit;
varying vec2 vTileUv;
varying float vLayer;
varying vec2 vWorldXZ;
varying vec2 vFlow;
flat varying int vWaterTile;
flat varying float vSkyLit;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
vTileUv = uv;
vLayer = aLayer;
vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;
vFlow = aFlow;
vWaterTile = int(aWaterTile + 0.5);
vSkyLit = aSkyLit;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tAtlas;
uniform sampler2D tGrassTop;
uniform float uTime;
uniform vec2 uCameraXZ;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform int uDebugMode;
varying vec2 vTileUv;
varying float vLayer;
varying vec2 vWorldXZ;
varying vec2 vFlow;
flat varying int vWaterTile;
flat varying float vSkyLit;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// LOD cross-fade. Only the near material (lodLevel=0) dither-discards;
// the far material always renders as a backdrop. We can't use a strict
// per-pixel mutex here because LOD0 and LOD1 have different geometries
// (LOD1 is half-res silhouette), so a pixel where LOD0 has solid voxels
// might not have a LOD1 fragment — a mutex would punch a sky-coloured
// hole there. Instead the far mesh is always present, pushed slightly
// back via polygonOffset so it loses the depth test wherever LOD0
// renders. As LOD0's dithered discard increases with distance, more
// pixels reveal the LOD1 backdrop, giving the smooth cross-fade.
// LOD cross-fade: LOD0 (lodLevel=0) is transparent and outputs alpha
// = 1 - fadeT, so as distance approaches uFadeEnd it fades to fully
// transparent and reveals LOD1 (drawn first as the opaque backdrop).
// LOD1 stays fully opaque. Computed on both materials so the debug
// visualisation can show fadeT for either LOD.
float lodFadeT;
{
  vec2 dXZ = abs(vWorldXZ - uCameraXZ);
  float dist = max(dXZ.x, dXZ.y);
  lodFadeT = smoothstep(uFadeStart, uFadeEnd, dist);
}
vec3 albedo;
bool isGrassTop = vLayer < 0.5;
bool isMossTop = abs(vLayer - 12.0) < 0.5;
bool isWaterTop = abs(vLayer - 14.0) < 0.5;
bool isWaterSide = abs(vLayer - 15.0) < 0.5;
if (isGrassTop || isMossTop) {
  // Grass-top: sample the 16-block-tileable 256×256 texture using world XZ
  // so the same image spans each 16×16 block region and wraps seamlessly.
  // Derivatives are continuous (worldXZ doesn't fract), so auto-LOD is fine
  // and we don't need textureGrad here.
  vec2 uvGrass = vWorldXZ / 16.0;
  albedo = texture2D(tGrassTop, uvGrass).rgb;
  // Moss: cool, damp shift. Drops red, keeps green, slight blue — reuses the
  // same big-texture so large-scale variation still comes through.
  if (isMossTop) albedo *= vec3(0.55, 1.05, 0.65);
} else if (isWaterTop) {
  // Animated water surface. Flow direction comes from the mesher attribute —
  // rivers carry a terrain-gradient-derived vFlow in world (fx, fz), lakes
  // stay (0, 0). On a top face UV.u runs along world Z and UV.v along world
  // X, so we swap components to get the UV-space drift direction.
  vec2 baseUv = fract(vTileUv);
  vec2 uvDrift = length(vFlow) > 0.01 ? vec2(vFlow.y, vFlow.x) : vec2(0.08, 0.05);
  // Sampling at uv + scroll makes content appear to move in −scroll direction,
  // so negate uvDrift to have the texture drift along the flow direction.
  vec2 scrollA = -uvDrift * uTime * 0.6;
  // Perpendicular secondary scroll at a slower speed so crests cross rather
  // than slide parallel — breaks up the "single sliding sheet" look.
  vec2 perp = vec2(-uvDrift.y, uvDrift.x);
  vec2 scrollB = -(uvDrift * 0.7 + perp * 0.5) * uTime * 0.4;
  vec2 dx = dFdx(vTileUv);
  vec2 dy = dFdy(vTileUv);
  vec3 a = textureGrad(tAtlas, vec3(fract(baseUv + scrollA), vLayer), dx, dy).rgb;
  vec3 b = textureGrad(tAtlas, vec3(fract(baseUv + scrollB), vLayer), dx, dy).rgb;
  albedo = mix(a, b, 0.5);
  // Slight brightness pulse to sell "shiny surface".
  albedo *= 0.95 + 0.08 * sin(uTime * 1.3 + vWorldXZ.x * 0.4 + vWorldXZ.y * 0.3);

  // Discrete water-tile geometry. vWaterTile is one of 5 values picked per
  // cell by the mesher from cardinal-neighbour topology. 0 = full water; 1–4
  // = a diagonal half-tile (NE/SE/SW/NW) with water in that quadrant.
  //
  // The diagonal cut is offset toward the grass side by HALF_OFFSET so the
  // diagonal river is closer to one block wide instead of 1/√2 ≈ 0.71. With
  // 0.207 the perpendicular gap between two cells' diagonals is exactly 1
  // block; 0.18 keeps the half-tile read while stopping the river from
  // looking pinched at every diagonal pair.
  //
  // Edge AA from fwidth() — one screen-pixel-wide soft transition, like a
  // rasterised vector line, regardless of viewing distance.
  if (vWaterTile != 0) {
    const float HALF_OFFSET = 0.18;
    vec2 cellUv = fract(vTileUv);
    float dist;
    if (vWaterTile == 1)      dist = (cellUv.x + cellUv.y) - (1.0 - HALF_OFFSET);
    else if (vWaterTile == 2) dist = (cellUv.y - cellUv.x) + HALF_OFFSET;
    else if (vWaterTile == 3) dist = (1.0 + HALF_OFFSET) - (cellUv.x + cellUv.y);
    else                       dist = (cellUv.x - cellUv.y) + HALF_OFFSET;
    float aa = fwidth(dist);
    float waterMask = smoothstep(-aa, aa, dist);
    vec3 grassC = texture2D(tGrassTop, vWorldXZ / 16.0).rgb;
    albedo = mix(grassC, albedo, waterMask);
  }
} else if (isWaterSide) {
  // Waterfall. vTileUv.y runs 0→h with world-Y on side faces (bottom at
  // UV.v=0). For the texture to visually move DOWN we need UV.v to increase
  // over time — sampling at (uv + (0, +uTime)) makes content drift toward
  // lower v, i.e. toward the bottom. Two samples with slightly different
  // speeds give a streakier, spraying look.
  vec2 baseUv = fract(vTileUv);
  vec2 fallA = vec2(0.0, uTime * 1.2);
  vec2 fallB = vec2(0.03 * sin(uTime * 2.0 + vWorldXZ.x), uTime * 0.9);
  vec2 dx = dFdx(vTileUv);
  vec2 dy = dFdy(vTileUv);
  vec3 a = textureGrad(tAtlas, vec3(fract(baseUv + fallA), vLayer), dx, dy).rgb;
  vec3 b = textureGrad(tAtlas, vec3(fract(baseUv + fallB), vLayer), dx, dy).rgb;
  // Weight toward the faster sample + brighten slightly — waterfalls read
  // whiter than still water due to entrained air.
  albedo = mix(a, b, 0.4) * 1.15;
  // Splash at the base: smoothstep on raw UV.v (not fract) so a multi-block
  // merged waterfall only lights up the bottom, not every block boundary.
  // The sin wobble keeps the foam line from looking perfectly flat.
  float splash = smoothstep(0.4, 0.0, vTileUv.y);
  splash *= 0.8 + 0.25 * sin(vTileUv.x * 6.0 + uTime * 5.0);
  // Fast-scrolling noise tap gives the foam a twinkling edge.
  vec3 fleck = textureGrad(tAtlas, vec3(fract(baseUv * 1.5 + vec2(0.17, uTime * 1.8)), vLayer), dx, dy).rgb;
  float sparkle = smoothstep(0.55, 0.75, fleck.r + fleck.g + fleck.b - 1.4);
  albedo = mix(albedo, vec3(0.95, 0.98, 1.0), clamp(splash * (0.5 + sparkle * 0.6), 0.0, 0.9));
} else {
  // textureGrad with unwrapped derivatives prevents mip-level collapse at
  // tile seams (fract() jumps 0.99→0.01 at a boundary otherwise).
  vec2 dx = dFdx(vTileUv);
  vec2 dy = dFdy(vTileUv);
  albedo = textureGrad(tAtlas, vec3(fract(vTileUv), vLayer), dx, dy).rgb;
}
diffuseColor.rgb *= albedo;
// Sky-occlusion shading. Three levels distinguish where the face sits in
// the world: full sky (1.0), under leaves/water (0.65 — gentle tree
// shadow), or sealed cave (0.30 — dim but visible without a light source).
// vSkyLit holds 0/1/2 from the mesher; the step() chain picks the right
// brightness without a switch.
float skyShade = vSkyLit > 1.5 ? 1.0 : (vSkyLit > 0.5 ? 0.65 : 0.30);
diffuseColor.rgb *= skyShade;
// Debug visualisations: bit 1 of uDebugMode replaces albedo with a
// distance-fade gradient (red = inside fade start, green = halfway,
// blue = past fade end), and tints LOD1 darker so you can tell which
// LOD a pixel came from. Red+blue at the same pixel = both LODs
// contributed something — verifies the cross-fade is wired up.
if ((uDebugMode & 2) != 0) {
  vec3 fadeColor = vec3(1.0 - lodFadeT, 1.0 - abs(lodFadeT - 0.5) * 2.0, lodFadeT);
  ${lodLevel === 1 ? 'fadeColor *= 0.5;' : ''}
  diffuseColor.rgb = fadeColor;
}
${lodLevel === 0 ? `// Alpha-blend LOD0 over the LOD1 backdrop. (uDebugMode bit 0 = "no
// fade": render LOD0 fully opaque so you can see how far it extends.)
diffuseColor.a = (uDebugMode & 1) != 0 ? 1.0 : (1.0 - lodFadeT);` : ''}`,
      );
  };

  return material;
}
