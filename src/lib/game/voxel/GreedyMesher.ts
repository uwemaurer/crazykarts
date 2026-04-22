import * as THREE from 'three';
import { AIR, getBlockTextures, type BlockId } from './BlockTypes';

const SHADE_TOP = 1.0;
const SHADE_BOTTOM = 0.5;
const SHADE_X = 0.82;
const SHADE_Z = 0.66;

const AO_BRIGHTNESS: readonly number[] = [1.0, 0.62, 0.38, 0.2];

export type VoxelSampler = (x: number, y: number, z: number) => BlockId;

function vertexAO(side1: number, side2: number, corner: number): number {
  if (side1 && side2) return 3;
  return side1 + side2 + corner;
}

export function buildChunkGeometry(
  getVoxel: VoxelSampler,
  dims: [number, number, number],
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
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

          const packed = block | (ao0 << 8) | (ao1 << 10) | (ao2 << 12) | (ao3 << 14);
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

          const tex = getBlockTextures(block);
          let layer: number;
          let shade: number;
          if (d === 1) {
            layer = positive ? tex.top : tex.bottom;
            shade = positive ? SHADE_TOP : SHADE_BOTTOM;
          } else {
            layer = tex.side;
            shade = d === 0 ? SHADE_X : SHADE_Z;
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
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
