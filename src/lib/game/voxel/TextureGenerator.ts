import * as THREE from 'three';
import {
  TEX_DIRT,
  TEX_GRASS_SIDE,
  TEX_GRASS_TOP,
  TEX_LEAVES,
  TEX_SAND,
  TEX_SNOW,
  TEX_SNOW_SIDE,
  TEX_STONE,
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

export function createBlockTextureArray(): THREE.DataArrayTexture {
  const data = new Uint8Array(TEXTURE_LAYER_COUNT * TILE_PIXELS * 4);
  generateGrassTop(data);
  generateGrassSide(data);
  generateDirt(data);
  generateStone(data);
  generateSand(data);
  generateWoodTop(data);
  generateWoodSide(data);
  generateLeaves(data);
  generateSnow(data);
  generateSnowSide(data);

  const texture = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, TEXTURE_LAYER_COUNT);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createChunkMaterial(texture: THREE.DataArrayTexture): THREE.Material {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.tAtlas = { value: texture };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aLayer;
varying vec2 vTileUv;
varying float vLayer;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
vTileUv = uv;
vLayer = aLayer;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tAtlas;
varying vec2 vTileUv;
varying float vLayer;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 atlasTexel = texture(tAtlas, vec3(fract(vTileUv), vLayer));
diffuseColor.rgb *= atlasTexel.rgb;`,
      );
  };

  return material;
}
