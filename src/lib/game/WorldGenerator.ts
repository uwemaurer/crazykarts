import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { VoxelChunk } from './voxel/VoxelChunk';
import { buildChunkGeometry } from './voxel/GreedyMesher';
import { createBlockTextureArray, createChunkMaterial } from './voxel/TextureGenerator';
import { AIR, DIRT, GRASS, LEAVES, SAND, SNOW, STONE, WOOD, type BlockId } from './voxel/BlockTypes';

export interface WorldChunk {
  mesh: THREE.Group;
  position: THREE.Vector2;
  bounds: THREE.Box3;
}

const CHUNK_W = 32;
const CHUNK_H = 48;
const SEA_LEVEL = 7;
const SNOW_LINE = 22;
const BASE_HEIGHT = 14;
const HEIGHT_AMP = 10;
const TREE_CHANCE = 0.007;

function deterministicRandom(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

export class WorldGenerator {
  private readonly noise2D: (x: number, y: number) => number;
  private readonly chunks = new Map<string, VoxelChunk>();
  private readonly chunkGroups = new Map<string, THREE.Group>();
  private readonly chunkMaterial: THREE.Material;
  private readonly seed: number;

  constructor(seed: number = Math.random()) {
    this.seed = Math.floor(seed * 2 ** 31);
    this.noise2D = createNoise2D(() => seed);
    this.chunkMaterial = createChunkMaterial(createBlockTextureArray());
  }

  public getChunkSize(): number {
    return CHUNK_W;
  }

  public setWireframe(enabled: boolean): void {
    (this.chunkMaterial as THREE.MeshLambertMaterial).wireframe = enabled;
  }

  public getHeightAt(worldX: number, worldZ: number): number {
    const cx = Math.floor(worldX / CHUNK_W);
    const cz = Math.floor(worldZ / CHUNK_W);
    const chunk = this.getOrGenerateChunk(cx, cz);
    const lx = Math.floor(worldX - cx * CHUNK_W);
    const lz = Math.floor(worldZ - cz * CHUNK_W);
    return chunk.getHeight(lx, lz);
  }

  public generateChunk(chunkX: number, chunkZ: number): WorldChunk {
    const voxels = this.getOrGenerateChunk(chunkX, chunkZ);
    const key = this.key(chunkX, chunkZ);
    let group = this.chunkGroups.get(key);
    if (!group) {
      group = new THREE.Group();
      group.position.set(chunkX * CHUNK_W, 0, chunkZ * CHUNK_W);
      this.chunkGroups.set(key, group);
    }
    this.rebuildChunkMesh(chunkX, chunkZ, voxels);

    const bounds = new THREE.Box3(
      new THREE.Vector3(chunkX * CHUNK_W, 0, chunkZ * CHUNK_W),
      new THREE.Vector3((chunkX + 1) * CHUNK_W, CHUNK_H, (chunkZ + 1) * CHUNK_W),
    );

    return { mesh: group, position: new THREE.Vector2(chunkX, chunkZ), bounds };
  }

  public destroySphere(center: THREE.Vector3, radius: number): number {
    const r2 = radius * radius;
    const minX = Math.floor(center.x - radius);
    const maxX = Math.ceil(center.x + radius);
    const minY = Math.max(0, Math.floor(center.y - radius));
    const maxY = Math.min(CHUNK_H - 1, Math.ceil(center.y + radius));
    const minZ = Math.floor(center.z - radius);
    const maxZ = Math.ceil(center.z + radius);

    const affected = new Set<string>();
    let removed = 0;

    for (let wx = minX; wx <= maxX; wx++) {
      for (let wz = minZ; wz <= maxZ; wz++) {
        const cx = Math.floor(wx / CHUNK_W);
        const cz = Math.floor(wz / CHUNK_W);
        const chunk = this.chunks.get(this.key(cx, cz));
        if (!chunk) continue;
        const lx = wx - cx * CHUNK_W;
        const lz = wz - cz * CHUNK_W;

        for (let wy = minY; wy <= maxY; wy++) {
          const dx = wx + 0.5 - center.x;
          const dy = wy + 0.5 - center.y;
          const dz = wz + 0.5 - center.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          if (chunk.get(lx, wy, lz) === AIR) continue;

          chunk.set(lx, wy, lz, AIR);
          removed++;

          affected.add(this.key(cx, cz));
          if (lx === 0) affected.add(this.key(cx - 1, cz));
          if (lx === CHUNK_W - 1) affected.add(this.key(cx + 1, cz));
          if (lz === 0) affected.add(this.key(cx, cz - 1));
          if (lz === CHUNK_W - 1) affected.add(this.key(cx, cz + 1));
        }
      }
    }

    for (const key of affected) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      chunk.computeHeightMap();
      const [cx, cz] = key.split(',').map(Number);
      this.rebuildChunkMesh(cx, cz, chunk);
    }

    return removed;
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private getOrGenerateChunk(cx: number, cz: number): VoxelChunk {
    const k = this.key(cx, cz);
    let chunk = this.chunks.get(k);
    if (!chunk) {
      chunk = new VoxelChunk(CHUNK_W, CHUNK_H, CHUNK_W);
      this.fillTerrain(chunk, cx, cz);
      this.scatterTrees(chunk, cx, cz);
      chunk.computeHeightMap();
      this.chunks.set(k, chunk);
    }
    return chunk;
  }

  private terrainHeight(worldX: number, worldZ: number): number {
    let value = 0;
    let amp = 1;
    let freq = 0.015;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      value += this.noise2D(worldX * freq, worldZ * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    value /= norm;
    const h = Math.floor(BASE_HEIGHT + value * HEIGHT_AMP);
    return Math.max(1, Math.min(CHUNK_H - 8, h));
  }

  private fillTerrain(chunk: VoxelChunk, cx: number, cz: number): void {
    const worldX0 = cx * CHUNK_W;
    const worldZ0 = cz * CHUNK_W;

    for (let x = 0; x < CHUNK_W; x++) {
      for (let z = 0; z < CHUNK_W; z++) {
        const h = this.terrainHeight(worldX0 + x, worldZ0 + z);
        for (let y = 0; y < h; y++) {
          let block: BlockId;
          if (y === h - 1) {
            if (h <= SEA_LEVEL) block = SAND;
            else if (h >= SNOW_LINE) block = SNOW;
            else block = GRASS;
          } else if (y >= h - 4) {
            block = h >= SNOW_LINE ? STONE : DIRT;
          } else {
            block = STONE;
          }
          chunk.set(x, y, z, block);
        }
      }
    }
  }

  private scatterTrees(chunk: VoxelChunk, cx: number, cz: number): void {
    for (let x = 2; x < CHUNK_W - 2; x++) {
      for (let z = 2; z < CHUNK_W - 2; z++) {
        const worldX = cx * CHUNK_W + x;
        const worldZ = cz * CHUNK_W + z;

        let topY = -1;
        for (let y = CHUNK_H - 1; y >= 0; y--) {
          if (chunk.get(x, y, z) !== AIR) { topY = y; break; }
        }
        if (topY < 0 || chunk.get(x, topY, z) !== GRASS) continue;

        if (deterministicRandom(worldX, worldZ, this.seed) > TREE_CHANCE) continue;

        this.placeTree(chunk, x, topY + 1, z);
      }
    }
  }

  private placeTree(chunk: VoxelChunk, x: number, baseY: number, z: number): void {
    const trunkHeight = 4;
    for (let dy = 0; dy < trunkHeight; dy++) {
      if (baseY + dy >= CHUNK_H) return;
      chunk.set(x, baseY + dy, z, WOOD);
    }

    const crownBase = baseY + trunkHeight - 1;
    for (let dy = 0; dy <= 1; dy++) {
      const ny = crownBase + dy;
      if (ny >= CHUNK_H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nx >= CHUNK_W || nz < 0 || nz >= CHUNK_W) continue;
          if (dx === 0 && dz === 0 && dy === 0) continue;
          if (chunk.get(nx, ny, nz) === AIR) chunk.set(nx, ny, nz, LEAVES);
        }
      }
    }
    const topY = crownBase + 2;
    if (topY < CHUNK_H && chunk.get(x, topY, z) === AIR) chunk.set(x, topY, z, LEAVES);
  }

  private rebuildChunkMesh(cx: number, cz: number, chunk: VoxelChunk): void {
    const key = this.key(cx, cz);
    const group = this.chunkGroups.get(key);
    if (!group) return;

    for (const child of group.children.slice()) {
      group.remove(child);
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry.dispose();
      }
    }

    const mesh = this.buildChunkMesh(chunk, cx, cz);
    if (mesh) group.add(mesh);
  }

  private buildChunkMesh(chunk: VoxelChunk, cx: number, cz: number): THREE.Mesh | null {
    const getVoxel = (x: number, y: number, z: number): BlockId => {
      if (y < 0 || y >= CHUNK_H) return AIR;
      if (x < 0) {
        const neighbor = this.chunks.get(this.key(cx - 1, cz));
        return neighbor ? neighbor.get(CHUNK_W - 1, y, z) : AIR;
      }
      if (x >= CHUNK_W) {
        const neighbor = this.chunks.get(this.key(cx + 1, cz));
        return neighbor ? neighbor.get(0, y, z) : AIR;
      }
      if (z < 0) {
        const neighbor = this.chunks.get(this.key(cx, cz - 1));
        return neighbor ? neighbor.get(x, y, CHUNK_W - 1) : AIR;
      }
      if (z >= CHUNK_W) {
        const neighbor = this.chunks.get(this.key(cx, cz + 1));
        return neighbor ? neighbor.get(x, y, 0) : AIR;
      }
      return chunk.get(x, y, z);
    };

    const geometry = buildChunkGeometry(getVoxel, [CHUNK_W, CHUNK_H, CHUNK_W]);
    if (!geometry) return null;

    const mesh = new THREE.Mesh(geometry, this.chunkMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
