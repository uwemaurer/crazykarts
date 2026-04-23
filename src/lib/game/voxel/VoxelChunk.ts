import type { BlockId } from './BlockTypes';
import { AIR, LEAVES, ROOF, WOOD } from './BlockTypes';

export class VoxelChunk {
  public readonly voxels: Uint8Array;
  private readonly heightMap: Int16Array;
  private lod1Cache: Uint8Array | null = null;
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
    this.lod1SizeX = sizeX >> 1;
    this.lod1SizeY = sizeY >> 1;
    this.lod1SizeZ = sizeZ >> 1;
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

  public computeHeightMap(): void {
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        let top = 0;
        for (let y = this.sizeY - 1; y >= 0; y--) {
          const block = this.voxels[this.idx(x, y, z)];
          if (block !== AIR && block !== WOOD && block !== LEAVES && block !== ROOF) {
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
}
