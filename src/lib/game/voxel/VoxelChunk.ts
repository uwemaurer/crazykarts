import type { BlockId } from './BlockTypes';
import { AIR, LEAVES, WOOD } from './BlockTypes';

export class VoxelChunk {
  public readonly voxels: Uint8Array;
  private readonly heightMap: Int16Array;

  constructor(
    public readonly sizeX: number,
    public readonly sizeY: number,
    public readonly sizeZ: number,
  ) {
    this.voxels = new Uint8Array(sizeX * sizeY * sizeZ);
    this.heightMap = new Int16Array(sizeX * sizeZ);
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
  }

  public computeHeightMap(): void {
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        let top = 0;
        for (let y = this.sizeY - 1; y >= 0; y--) {
          const block = this.voxels[this.idx(x, y, z)];
          if (block !== AIR && block !== WOOD && block !== LEAVES) {
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
