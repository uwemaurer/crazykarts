import type { BlockId } from './BlockTypes';
import { AIR, BARBED_WIRE, BARS, LEAVES, POLICE, ROOF, WATER, WOOD } from './BlockTypes';

// Face bit indices used by the flood-fill connectivity matrix.
export const FACE_PX = 0;
export const FACE_NX = 1;
export const FACE_PY = 2;
export const FACE_NY = 3;
export const FACE_PZ = 4;
export const FACE_NZ = 5;
export const FACE_MASK_ALL = 0b111111;

export class VoxelChunk {
  public readonly voxels: Uint8Array;
  private readonly heightMap: Int16Array;
  // Per-column flow direction for water surfaces. Int8 [-127..127] → [-1..1].
  // Stored per (x, z) rather than per (x, y, z) because water flow is a 2D
  // horizontal field — a river's direction is the same whether you sample the
  // surface block or one below. Non-water columns stay (0, 0).
  public readonly flowX: Int8Array;
  public readonly flowZ: Int8Array;
  // Per-voxel "is this cell reachable by direct skylight from above". Computed
  // after generation; consumed by the mesher to drive a per-vertex `aSkyLit`
  // attribute so cave interiors render with a darker ambient floor.
  public readonly skyOpen: Uint8Array;
  private lod1Cache: Uint8Array | null = null;
  private connectivityCache: Uint8Array | null = null;
  public readonly lod1SizeX: number;
  public readonly lod1SizeY: number;
  public readonly lod1SizeZ: number;

  constructor(
    public readonly sizeX: number,
    public readonly sizeY: number,
    public readonly sizeZ: number,
  ) {
    this.voxels = new Uint8Array(sizeX * sizeY * sizeZ);
    this.heightMap = new Int16Array(sizeX * sizeZ);
    this.flowX = new Int8Array(sizeX * sizeZ);
    this.flowZ = new Int8Array(sizeX * sizeZ);
    this.skyOpen = new Uint8Array(sizeX * sizeY * sizeZ);
    this.lod1SizeX = sizeX >> 1;
    this.lod1SizeY = sizeY >> 1;
    this.lod1SizeZ = sizeZ >> 1;
  }

  public setFlow(x: number, z: number, fx: number, fz: number): void {
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return;
    const i = z * this.sizeX + x;
    this.flowX[i] = Math.max(-127, Math.min(127, Math.round(fx * 127)));
    this.flowZ[i] = Math.max(-127, Math.min(127, Math.round(fz * 127)));
  }

  public getFlowX(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return 0;
    return this.flowX[z * this.sizeX + x] / 127;
  }

  public getFlowZ(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return 0;
    return this.flowZ[z * this.sizeX + x] / 127;
  }

  public idx(x: number, y: number, z: number): number {
    return (y * this.sizeZ + z) * this.sizeX + x;
  }

  public get(x: number, y: number, z: number): BlockId {
    if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) return AIR;
    return this.voxels[this.idx(x, y, z)];
  }

  public set(x: number, y: number, z: number, block: BlockId): void {
    this.voxels[this.idx(x, y, z)] = block;
    this.lod1Cache = null;
    this.connectivityCache = null;
    // skyOpen is recomputed by the caller after batch edits via
    // computeSkyOpen(); per-voxel `set` doesn't keep it in sync to avoid
    // O(H) work per write during chunk generation. Mining edits from
    // gameplay are followed by a chunk rebuild that calls computeSkyOpen.
  }

  public getLOD1(x: number, y: number, z: number): BlockId {
    if (x < 0 || y < 0 || z < 0 || x >= this.lod1SizeX || y >= this.lod1SizeY || z >= this.lod1SizeZ) return AIR;
    return this.getLOD1Voxels()[(y * this.lod1SizeZ + z) * this.lod1SizeX + x];
  }

  public getLOD1Voxels(): Uint8Array {
    if (!this.lod1Cache) this.lod1Cache = this.computeLOD1();
    return this.lod1Cache;
  }

  // For each 2x2x2 cell, pick the top-most non-AIR block so silhouettes and
  // top surfaces (grass, snow, roofs) dominate the distant view.
  private computeLOD1(): Uint8Array {
    const w = this.lod1SizeX, h = this.lod1SizeY, d = this.lod1SizeZ;
    const out = new Uint8Array(w * h * d);
    for (let ly = 0; ly < h; ly++) {
      for (let lz = 0; lz < d; lz++) {
        for (let lx = 0; lx < w; lx++) {
          let pick: BlockId = AIR;
          // Scan the top layer first (dy=1), then the bottom (dy=0).
          for (let dy = 1; dy >= 0 && pick === AIR; dy--) {
            for (let dz = 0; dz < 2 && pick === AIR; dz++) {
              for (let dx = 0; dx < 2 && pick === AIR; dx++) {
                const fx = (lx << 1) + dx;
                const fy = (ly << 1) + dy;
                const fz = (lz << 1) + dz;
                const v = this.voxels[this.idx(fx, fy, fz)];
                if (v !== AIR) pick = v;
              }
            }
          }
          out[(ly * d + lz) * w + lx] = pick;
        }
      }
    }
    return out;
  }

  // Walk each (x, z) column from the top down and assign one of three
  // skyOpen levels per cell:
  //   2 — direct sky access (no obstruction overhead).
  //   1 — partial: leaves or water somewhere above filter the light.
  //   0 — sealed: an opaque solid sits above; cave-dark.
  // Leaves and water transmit some light (tree shadow shouldn't read like
  // a cave), so they don't fully seal — they drop level 2 → 1. Anything
  // else opaque seals level → 0 for everything below. The mesher samples
  // this at the air-side neighbour of each emitted face; the shader maps
  // the level to a brightness multiplier.
  public computeSkyOpen(): void {
    const W = this.sizeX, H = this.sizeY, D = this.sizeZ;
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        let level = 2;
        for (let y = H - 1; y >= 0; y--) {
          const i = this.idx(x, y, z);
          const v = this.voxels[i];
          if (v === AIR) {
            this.skyOpen[i] = level;
          } else if (v === LEAVES || v === WATER) {
            // Transmit but attenuate. The leaves/water cell itself records
            // the pre-attenuation level so its top face stays bright.
            this.skyOpen[i] = level;
            if (level > 1) level = 1;
          } else {
            // Opaque solid. Record the pre-seal level for this cell so its
            // own top face renders correctly, then seal everything below.
            this.skyOpen[i] = level;
            level = 0;
          }
        }
      }
    }
  }

  public getSkyOpen(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) return 2;
    return this.skyOpen[this.idx(x, y, z)];
  }

  public computeHeightMap(): void {
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        let top = 0;
        for (let y = this.sizeY - 1; y >= 0; y--) {
          const block = this.voxels[this.idx(x, y, z)];
          if (block !== AIR && block !== WOOD && block !== LEAVES && block !== ROOF && block !== POLICE && block !== BARS && block !== BARBED_WIRE) {
            top = y + 1;
            break;
          }
        }
        this.heightMap[z * this.sizeX + x] = top;
      }
    }
  }

  public getHeight(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return 0;
    return this.heightMap[z * this.sizeX + x];
  }

  // Returns a 6-byte array where matrix[face] is a bitmask of faces that `face`
  // can reach via connected AIR. Used for face flood-fill culling: to decide
  // whether to visit a chunk's neighbor, the caller checks if the neighbor's
  // "outgoing" face is connected to any of the faces we entered through.
  public getConnectivity(): Uint8Array {
    if (!this.connectivityCache) this.connectivityCache = this.computeConnectivity();
    return this.connectivityCache;
  }

  private computeConnectivity(): Uint8Array {
    const W = this.sizeX, H = this.sizeY, D = this.sizeZ;
    const plane = W * D;
    const matrix = new Uint8Array(6);
    const visited = new Uint8Array(W * H * D);
    const stack: number[] = [];

    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const startIdx = (y * D + z) * W + x;
          if (this.voxels[startIdx] !== AIR) continue;
          if (visited[startIdx]) continue;

          // Flood-fill this AIR region and gather the set of faces it touches.
          let faceBits = 0;
          stack.length = 0;
          stack.push(startIdx);
          visited[startIdx] = 1;

          while (stack.length > 0) {
            const idx = stack.pop()!;
            const cy = (idx / plane) | 0;
            const rem = idx - cy * plane;
            const cz = (rem / W) | 0;
            const cx = rem - cz * W;

            if (cx === 0) faceBits |= 1 << FACE_NX;
            if (cx === W - 1) faceBits |= 1 << FACE_PX;
            if (cy === 0) faceBits |= 1 << FACE_NY;
            if (cy === H - 1) faceBits |= 1 << FACE_PY;
            if (cz === 0) faceBits |= 1 << FACE_NZ;
            if (cz === D - 1) faceBits |= 1 << FACE_PZ;

            // +X
            if (cx + 1 < W) {
              const n = idx + 1;
              if (!visited[n] && this.voxels[n] === AIR) { visited[n] = 1; stack.push(n); }
            }
            // -X
            if (cx > 0) {
              const n = idx - 1;
              if (!visited[n] && this.voxels[n] === AIR) { visited[n] = 1; stack.push(n); }
            }
            // +Y
            if (cy + 1 < H) {
              const n = idx + plane;
              if (!visited[n] && this.voxels[n] === AIR) { visited[n] = 1; stack.push(n); }
            }
            // -Y
            if (cy > 0) {
              const n = idx - plane;
              if (!visited[n] && this.voxels[n] === AIR) { visited[n] = 1; stack.push(n); }
            }
            // +Z
            if (cz + 1 < D) {
              const n = idx + W;
              if (!visited[n] && this.voxels[n] === AIR) { visited[n] = 1; stack.push(n); }
            }
            // -Z
            if (cz > 0) {
              const n = idx - W;
              if (!visited[n] && this.voxels[n] === AIR) { visited[n] = 1; stack.push(n); }
            }
          }

          // Every face this region touches is mutually reachable through it.
          for (let f = 0; f < 6; f++) {
            if (faceBits & (1 << f)) matrix[f] |= faceBits;
          }
        }
      }
    }

    return matrix;
  }
}
