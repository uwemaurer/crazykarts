import * as THREE from 'three';
import { AIR, TEX_GRASS_SIDE, WATER, getBlockTextures, type BlockId } from './BlockTypes';

const SHADE_TOP = 1.0;
const SHADE_BOTTOM = 0.5;
const SHADE_X = 0.82;
const SHADE_Z = 0.66;

const AO_BRIGHTNESS: readonly number[] = [1.0, 0.62, 0.38, 0.2];

export type VoxelSampler = (x: number, y: number, z: number) => BlockId;
// Horizontal flow vector per (x, z) column, ignoring y. Used only for water
// surfaces in the shader; non-flowing cells return (0, 0). Quantised to 4
// bits per component when encoded into the greedy-merge mask so cells with
// different flow directions don't merge into one quad.
export type FlowSampler = (x: number, z: number) => readonly [number, number];
// Per-voxel "is this cell reachable by direct skylight". Queried at the
// air-side neighbour of each emitted face so cave faces (where the air cell
// is sealed below ground) get aSkyLit=0 in the shader.
export type SkyOpenSampler = (x: number, y: number, z: number) => number;

// Discrete tile classification for water top faces. Picked per cell from the
// pattern of cardinal water neighbours so the river outline threads cleanly
// between cells, anti-aliased like a vector line. 0 = full water (all
// four neighbours water, opposite-pair pass-through, ≤1 neighbour, or
// T-junction). 1–4 = one of four diagonal half-tiles, named by which
// quadrant of the cell holds water.
const WATER_TILE_FULL = 0;
const WATER_TILE_NE = 1;
const WATER_TILE_SE = 2;
const WATER_TILE_SW = 3;
const WATER_TILE_NW = 4;

function vertexAO(side1: number, side2: number, corner: number): number {
  if (side1 && side2) return 3;
  return side1 + side2 + corner;
}

// Quantise a flow component from [-1, 1] to a 4-bit unsigned index [0, 15].
// Centre (7) represents zero; the mask encoder packs two of these side by
// side so "no flow" is the same value everywhere and greedy-merges freely.
function quantFlow(v: number): number {
  const q = Math.round(v * 7 + 7);
  return Math.max(0, Math.min(15, q));
}
function unquantFlow(q: number): number {
  return (q - 7) / 7;
}

export function buildChunkGeometry(
  getVoxel: VoxelSampler,
  dims: [number, number, number],
  getFlow?: FlowSampler,
  getSkyOpen?: SkyOpenSampler,
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
  const flows: number[] = [];
  const waterTiles: number[] = [];
  const skies: number[] = [];
  const indices: number[] = [];

  const samplePos: [number, number, number] = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u];
    const dv = dims[v];
    const dd = dims[d];

    const x: [number, number, number] = [0, 0, 0];
    const q: [number, number, number] = [0, 0, 0];
    q[d] = 1;

    const mask = new Int32Array(du * dv);

    for (x[d] = -1; x[d] < dd;) {
      let n = 0;
      for (x[v] = 0; x[v] < dv; x[v]++) {
        for (x[u] = 0; x[u] < du; x[u]++, n++) {
          const a = x[d] >= 0 ? getVoxel(x[0], x[1], x[2]) : AIR;
          const b = x[d] < dd - 1 ? getVoxel(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : AIR;
          const aSolid = a !== AIR;
          const bSolid = b !== AIR;
          if (aSolid === bSolid) {
            mask[n] = 0;
            continue;
          }

          const positive = aSolid;
          const block = positive ? a : b;
          const airD = positive ? x[d] + 1 : x[d];

          samplePos[d] = airD;
          samplePos[u] = x[u] - 1; samplePos[v] = x[v];     const sNu = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u] + 1; samplePos[v] = x[v];     const sPu = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u];     samplePos[v] = x[v] - 1; const sNv = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u];     samplePos[v] = x[v] + 1; const sPv = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u] - 1; samplePos[v] = x[v] - 1; const cNN = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u] + 1; samplePos[v] = x[v] - 1; const cPN = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u] + 1; samplePos[v] = x[v] + 1; const cPP = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;
          samplePos[u] = x[u] - 1; samplePos[v] = x[v] + 1; const cNP = getVoxel(samplePos[0], samplePos[1], samplePos[2]) !== AIR ? 1 : 0;

          const ao0 = vertexAO(sNu, sNv, cNN);
          const ao1 = vertexAO(sPu, sNv, cPN);
          const ao2 = vertexAO(sPu, sPv, cPP);
          const ao3 = vertexAO(sNu, sPv, cNP);

          // Flow lives at (x, z); sample at the block's column. When getFlow
          // is unset or returns zero, qx=qz=7 → packedFlow=0x77 for every
          // cell and greedy-merge works exactly as before.
          let packedFlow = 0x77;
          if (getFlow) {
            // Use the block's own column (the one carrying the voxel).
            const [fx, fz] = getFlow(x[0], x[2]);
            packedFlow = quantFlow(fx) | (quantFlow(fz) << 4);
          }

          // Discrete water-tile classification for ALL faces of a WATER cell
          // (top, bottom, sides). For top faces it drives the water/grass
          // diagonal mask; for side faces it picks WATER_SIDE vs GRASS_SIDE
          // textures so the cell's exposed walls match its top's geometry.
          let waterTile = WATER_TILE_FULL;
          if (block === WATER) {
            // Water cell sits on the solid side. For positive faces (a-side),
            // that's (x[0], x[1], x[2]); for negative faces (b-side), step
            // forward by q.
            const cx = positive ? x[0] : x[0] + q[0];
            const cy = positive ? x[1] : x[1] + q[1];
            const cz = positive ? x[2] : x[2] + q[2];
            const wN = getVoxel(cx, cy, cz + 1) === WATER;
            const wS = getVoxel(cx, cy, cz - 1) === WATER;
            const wE = getVoxel(cx + 1, cy, cz) === WATER;
            const wW = getVoxel(cx - 1, cy, cz) === WATER;
            const count = (wN ? 1 : 0) + (wS ? 1 : 0) + (wE ? 1 : 0) + (wW ? 1 : 0);
            if (count === 2 && !(wN && wS) && !(wE && wW)) {
              if (wN && wE) waterTile = WATER_TILE_NE;
              else if (wS && wE) waterTile = WATER_TILE_SE;
              else if (wS && wW) waterTile = WATER_TILE_SW;
              else if (wN && wW) waterTile = WATER_TILE_NW;
            }
          }

          // Sky-access level (0/1/2) read at the AIR-side neighbour — the
          // cell a viewer of this face sits in. Defaults to 2 (full sky)
          // when no callback is provided so the unmodified mesher path
          // doesn't accidentally darken anything.
          let skyLevel = 2;
          if (getSkyOpen) {
            const ax = positive ? x[0] + q[0] : x[0];
            const ay = positive ? x[1] + q[1] : x[1];
            const az = positive ? x[2] + q[2] : x[2];
            skyLevel = getSkyOpen(ax, ay, az);
          }

          const packed = block | (ao0 << 8) | (ao1 << 10) | (ao2 << 12) | (ao3 << 14) | (packedFlow << 16) | (waterTile << 24) | (skyLevel << 27);
          mask[n] = positive ? packed : -packed;
        }
      }

      x[d]++;

      n = 0;
      for (let j = 0; j < dv; j++) {
        for (let i = 0; i < du;) {
          const m = mask[n];
          if (m === 0) { i++; n++; continue; }

          let w = 1;
          while (i + w < du && mask[n + w] === m) w++;

          let h = 1;
          let extend = true;
          while (j + h < dv && extend) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * du] !== m) { extend = false; break; }
            }
            if (extend) h++;
          }

          x[u] = i;
          x[v] = j;
          const duVec: [number, number, number] = [0, 0, 0];
          const dvVec: [number, number, number] = [0, 0, 0];
          duVec[u] = w;
          dvVec[v] = h;

          const positive = m > 0;
          const absM = positive ? m : -m;
          const block = (absM & 0xff) as BlockId;
          const ao0 = (absM >> 8) & 0x3;
          const ao1 = (absM >> 10) & 0x3;
          const ao2 = (absM >> 12) & 0x3;
          const ao3 = (absM >> 14) & 0x3;
          const packedFlow = (absM >> 16) & 0xff;
          const fxDecoded = unquantFlow(packedFlow & 0xf);
          const fzDecoded = unquantFlow((packedFlow >> 4) & 0xf);
          const waterTileDecoded = (absM >> 24) & 0x7;
          const skyLitDecoded = (absM >> 27) & 0x3;

          const tex = getBlockTextures(block);
          let layer: number;
          let shade: number;
          if (d === 1) {
            layer = positive ? tex.top : tex.bottom;
            shade = positive ? SHADE_TOP : SHADE_BOTTOM;
          } else {
            layer = tex.side;
            shade = d === 0 ? SHADE_X : SHADE_Z;
            // Half-tile water cells: vertical sides on the grass half of the
            // diagonal show the bank (grass-on-dirt), not water. The N/E/S/W
            // sides for each tile orientation are baked from the same diagonal
            // that drives the top-face mask.
            if (block === WATER && waterTileDecoded !== WATER_TILE_FULL) {
              let isWaterSide = false;
              if (d === 0) {
                // d=0 ⇒ X-axis face. positive=+X (E face), negative=-X (W face).
                isWaterSide = positive
                  ? (waterTileDecoded === WATER_TILE_NE || waterTileDecoded === WATER_TILE_SE)
                  : (waterTileDecoded === WATER_TILE_NW || waterTileDecoded === WATER_TILE_SW);
              } else {
                // d=2 ⇒ Z-axis face. positive=+Z (N face), negative=-Z (S face).
                isWaterSide = positive
                  ? (waterTileDecoded === WATER_TILE_NE || waterTileDecoded === WATER_TILE_NW)
                  : (waterTileDecoded === WATER_TILE_SE || waterTileDecoded === WATER_TILE_SW);
              }
              if (!isWaterSide) layer = TEX_GRASS_SIDE;
            }
          }

          const g0 = shade * AO_BRIGHTNESS[ao0];
          const g1 = shade * AO_BRIGHTNESS[ao1];
          const g2 = shade * AO_BRIGHTNESS[ao2];
          const g3 = shade * AO_BRIGHTNESS[ao3];

          const normal: [number, number, number] = [0, 0, 0];
          normal[d] = positive ? 1 : -1;

          const baseIdx = positions.length / 3;
          const p0 = [x[0], x[1], x[2]];
          const p1 = [x[0] + duVec[0], x[1] + duVec[1], x[2] + duVec[2]];
          const p2 = [x[0] + duVec[0] + dvVec[0], x[1] + duVec[1] + dvVec[1], x[2] + duVec[2] + dvVec[2]];
          const p3 = [x[0] + dvVec[0], x[1] + dvVec[1], x[2] + dvVec[2]];

          positions.push(...p0, ...p1, ...p2, ...p3);
          for (let k = 0; k < 4; k++) {
            normals.push(normal[0], normal[1], normal[2]);
            layers.push(layer);
            flows.push(fxDecoded, fzDecoded);
            waterTiles.push(waterTileDecoded);
            skies.push(skyLitDecoded);
          }
          colors.push(g0, g0, g0, g1, g1, g1, g2, g2, g2, g3, g3, g3);

          if (d === 0) {
            uvs.push(0, 0, 0, w, h, w, h, 0);
          } else if (d === 2) {
            uvs.push(0, 0, w, 0, w, h, 0, h);
          } else {
            uvs.push(0, 0, w, 0, w, h, 0, h);
          }

          const flip = ao0 + ao2 > ao1 + ao3;
          if (positive) {
            if (flip) {
              indices.push(baseIdx, baseIdx + 1, baseIdx + 3, baseIdx + 1, baseIdx + 2, baseIdx + 3);
            } else {
              indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
            }
          } else {
            if (flip) {
              indices.push(baseIdx, baseIdx + 3, baseIdx + 1, baseIdx + 1, baseIdx + 3, baseIdx + 2);
            } else {
              indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx, baseIdx + 3, baseIdx + 2);
            }
          }

          for (let l = 0; l < h; l++) {
            for (let k = 0; k < w; k++) {
              mask[n + k + l * du] = 0;
            }
          }

          i += w;
          n += w;
        }
      }
    }
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geometry.setAttribute('aWaterTile', new THREE.Float32BufferAttribute(waterTiles, 1));
  geometry.setAttribute('aSkyLit', new THREE.Float32BufferAttribute(skies, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
