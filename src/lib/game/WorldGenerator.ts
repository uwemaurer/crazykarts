import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { VoxelChunk } from './voxel/VoxelChunk';
import { buildChunkGeometry } from './voxel/GreedyMesher';
import { createBlockTextureArray, createChunkMaterial } from './voxel/TextureGenerator';
import { AIR, DIRT, GRASS, LEAVES, ROAD, ROOF, SAND, SNOW, STONE, WOOD, type BlockId } from './voxel/BlockTypes';

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

const REGION_CHUNKS = 4;
const REGION_W = REGION_CHUNKS * CHUNK_W;
const VILLAGE_PROB = 0.6;
const VILLAGE_RADIUS = 18;
const ROAD_HALF_WIDTH = 2;

export interface Village {
  rx: number;
  rz: number;
  x: number;
  z: number;
  floorY: number;
  seed: number;
}

export interface PlanBlock {
  wx: number;
  wy: number;
  wz: number;
  block: BlockId;
}

interface House {
  x: number;
  z: number;
  w: number;
  d: number;
  floorY: number;
}

// Construction site offset relative to village center (ordinal angle, clears cardinal roads)
const SITE_OFFSET_X = -11;
const SITE_OFFSET_Z = 11;
const SITE_W = 5;
const SITE_D = 5;
const SITE_H = 3;
const SITE_INITIAL_FRACTION = 0.4;

// Farm offset (opposite ordinal)
const FARM_OFFSET_X = 11;
const FARM_OFFSET_Z = 11;
const FARM_W = 5;
const FARM_D = 5;

function deterministicRandom(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

export type WorldDiffs = Record<string, Array<[number, number, number, number]>>;

export class WorldGenerator {
  private readonly noise2D: (x: number, y: number) => number;
  private readonly chunks = new Map<string, VoxelChunk>();
  private readonly chunkGroups = new Map<string, THREE.Group>();
  private readonly chunkGroupsLOD1 = new Map<string, THREE.Group>();
  private readonly chunkMaterial: THREE.Material;
  private readonly seed: number;
  private readonly inputSeed: number;
  // Per-chunk overrides: chunkKey -> "lx,ly,lz" -> blockId. Last-write-wins dedup.
  private readonly mods = new Map<string, Map<string, BlockId>>();

  constructor(seed: number = Math.random()) {
    this.inputSeed = seed;
    this.seed = Math.floor(seed * 2 ** 31);
    this.noise2D = createNoise2D(() => seed);
    this.chunkMaterial = createChunkMaterial(createBlockTextureArray());
  }

  public getInputSeed(): number {
    return this.inputSeed;
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

  public generateChunkLOD1(chunkX: number, chunkZ: number): WorldChunk {
    const voxels = this.getOrGenerateChunk(chunkX, chunkZ);
    const key = this.key(chunkX, chunkZ);
    let group = this.chunkGroupsLOD1.get(key);
    if (!group) {
      group = new THREE.Group();
      group.position.set(chunkX * CHUNK_W, 0, chunkZ * CHUNK_W);
      // The LOD mesh is built in half-unit voxel coords (16x24x16);
      // scale the group so it covers the same 32x48x32 world footprint.
      group.scale.set(2, 2, 2);
      this.chunkGroupsLOD1.set(key, group);
    }
    this.rebuildChunkMeshLOD1(chunkX, chunkZ, voxels);

    const bounds = new THREE.Box3(
      new THREE.Vector3(chunkX * CHUNK_W, 0, chunkZ * CHUNK_W),
      new THREE.Vector3((chunkX + 1) * CHUNK_W, CHUNK_H, (chunkZ + 1) * CHUNK_W),
    );

    return { mesh: group, position: new THREE.Vector2(chunkX, chunkZ), bounds };
  }

  public disposeChunkLOD1(chunkX: number, chunkZ: number): void {
    const key = this.key(chunkX, chunkZ);
    const group = this.chunkGroupsLOD1.get(key);
    if (!group) return;
    for (const child of group.children.slice()) {
      group.remove(child);
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry.dispose();
      }
    }
    this.chunkGroupsLOD1.delete(key);
  }

  public disposeChunkFull(chunkX: number, chunkZ: number): void {
    const key = this.key(chunkX, chunkZ);
    const group = this.chunkGroups.get(key);
    if (!group) return;
    for (const child of group.children.slice()) {
      group.remove(child);
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry.dispose();
      }
    }
    this.chunkGroups.delete(key);
  }

  public getVillagesNear(worldX: number, worldZ: number, halfExtent: number): Village[] {
    const rxC = Math.floor(worldX / REGION_W);
    const rzC = Math.floor(worldZ / REGION_W);
    const reach = Math.ceil(halfExtent / REGION_W) + 1;
    const villages: Village[] = [];
    for (let drx = -reach; drx <= reach; drx++) {
      for (let drz = -reach; drz <= reach; drz++) {
        const v = this.getVillage(rxC + drx, rzC + drz);
        if (!v) continue;
        if (Math.abs(v.x - worldX) <= halfExtent && Math.abs(v.z - worldZ) <= halfExtent) {
          villages.push(v);
        }
      }
    }
    return villages;
  }

  public getConstructionPlan(v: Village): PlanBlock[] {
    const cx = v.x + SITE_OFFSET_X;
    const cz = v.z + SITE_OFFSET_Z;
    const halfW = Math.floor(SITE_W / 2);
    const halfD = Math.floor(SITE_D / 2);
    const blocks: PlanBlock[] = [];

    // Walls
    for (let dx = 0; dx < SITE_W; dx++) {
      for (let dz = 0; dz < SITE_D; dz++) {
        const isEdge = dx === 0 || dx === SITE_W - 1 || dz === 0 || dz === SITE_D - 1;
        if (!isEdge) continue;
        for (let dy = 0; dy < SITE_H; dy++) {
          blocks.push({
            wx: cx - halfW + dx,
            wy: v.floorY + dy,
            wz: cz - halfD + dz,
            block: WOOD,
          });
        }
      }
    }
    // Flat roof
    for (let dx = 0; dx < SITE_W; dx++) {
      for (let dz = 0; dz < SITE_D; dz++) {
        blocks.push({
          wx: cx - halfW + dx,
          wy: v.floorY + SITE_H,
          wz: cz - halfD + dz,
          block: ROOF,
        });
      }
    }

    return blocks;
  }

  public getPendingConstructionBlocks(v: Village): PlanBlock[] {
    const plan = this.getConstructionPlan(v);
    const pending: PlanBlock[] = [];
    for (const b of plan) {
      const r = deterministicRandom(b.wx, b.wz * 31 + b.wy, v.seed);
      if (r <= SITE_INITIAL_FRACTION) continue;
      pending.push(b);
    }
    return pending;
  }

  public getConstructionSiteCenter(v: Village): THREE.Vector3 {
    return new THREE.Vector3(v.x + SITE_OFFSET_X, v.floorY, v.z + SITE_OFFSET_Z);
  }

  public getFarmCenter(v: Village): THREE.Vector3 {
    return new THREE.Vector3(v.x + FARM_OFFSET_X, v.floorY, v.z + FARM_OFFSET_Z);
  }

  public getChunkConnectivity(cx: number, cz: number): Uint8Array | null {
    const chunk = this.chunks.get(this.key(cx, cz));
    return chunk ? chunk.getConnectivity() : null;
  }

  public getChunkVoxels(cx: number, cz: number): VoxelChunk | null {
    return this.chunks.get(this.key(cx, cz)) ?? null;
  }

  public getBlock(wx: number, wy: number, wz: number): BlockId {
    if (wy < 0 || wy >= CHUNK_H) return AIR;
    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_W);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return AIR;
    const lx = wx - cx * CHUNK_W;
    const lz = wz - cz * CHUNK_W;
    return chunk.get(lx, wy, lz);
  }

  public raycastBlock(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { wx: number; wy: number; wz: number; nx: number; ny: number; nz: number; block: BlockId } | null {
    // Amanatides & Woo DDA voxel traversal.
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const dx = direction.x, dy = direction.y, dz = direction.z;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const nextBoundary = (o: number, d: number, b: number): number => {
      if (d === 0) return Infinity;
      const next = d > 0 ? b + 1 : b;
      return (next - o) / d;
    };

    let tMaxX = nextBoundary(origin.x, dx, x);
    let tMaxY = nextBoundary(origin.y, dy, y);
    let tMaxZ = nextBoundary(origin.z, dz, z);
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

    // Check origin block first
    const originBlock = this.getBlock(x, y, z);
    if (originBlock !== AIR) {
      return { wx: x, wy: y, wz: z, nx: 0, ny: 0, nz: 0, block: originBlock };
    }

    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    while (t <= maxDistance) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX; x += stepX; tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        t = tMaxY; y += stepY; tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDistance) return null;
      const block = this.getBlock(x, y, z);
      if (block !== AIR) {
        return { wx: x, wy: y, wz: z, nx, ny, nz, block };
      }
    }
    return null;
  }

  public placeBlock(wx: number, wy: number, wz: number, block: BlockId): boolean {
    const cx = Math.floor(wx / CHUNK_W);
    const cz = Math.floor(wz / CHUNK_W);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return false;
    const lx = wx - cx * CHUNK_W;
    const lz = wz - cz * CHUNK_W;
    if (wy < 0 || wy >= CHUNK_H) return false;
    if (chunk.get(lx, wy, lz) === block) return true;
    chunk.set(lx, wy, lz, block);
    this.recordMod(cx, cz, lx, wy, lz, block);
    chunk.computeHeightMap();
    this.rebuildChunkMeshes(cx, cz, chunk);

    // Rebuild neighbor chunk meshes when placing on a chunk edge
    if (lx === 0) this.rebuildNeighbor(cx - 1, cz);
    if (lx === CHUNK_W - 1) this.rebuildNeighbor(cx + 1, cz);
    if (lz === 0) this.rebuildNeighbor(cx, cz - 1);
    if (lz === CHUNK_W - 1) this.rebuildNeighbor(cx, cz + 1);
    return true;
  }

  private rebuildChunkMeshes(cx: number, cz: number, chunk: VoxelChunk): void {
    const key = this.key(cx, cz);
    if (this.chunkGroups.has(key)) this.rebuildChunkMesh(cx, cz, chunk);
    if (this.chunkGroupsLOD1.has(key)) this.rebuildChunkMeshLOD1(cx, cz, chunk);
  }

  private rebuildNeighbor(cx: number, cz: number): void {
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return;
    this.rebuildChunkMeshes(cx, cz, chunk);
  }

  public sampleMinimap(worldX: number, worldZ: number): { r: number; g: number; b: number } {
    const cx = Math.floor(worldX / CHUNK_W);
    const cz = Math.floor(worldZ / CHUNK_W);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return { r: 18, g: 22, b: 30 };

    const lx = Math.floor(worldX - cx * CHUNK_W);
    const lz = Math.floor(worldZ - cz * CHUNK_W);

    let topBlock: BlockId = AIR;
    let topY = -1;
    for (let y = CHUNK_H - 1; y >= 0; y--) {
      const b = chunk.get(lx, y, lz);
      if (b !== AIR) { topBlock = b; topY = y; break; }
    }

    if (topY < SEA_LEVEL) return { r: 52, g: 98, b: 160 };

    switch (topBlock) {
      case GRASS:  return { r: 72, g: 136, b: 58 };
      case DIRT:   return { r: 110, g: 78, b: 48 };
      case STONE:  return { r: 130, g: 130, b: 138 };
      case SAND:   return { r: 220, g: 200, b: 142 };
      case WOOD:   return { r: 100, g: 60, b: 28 };
      case LEAVES: return { r: 48, g: 110, b: 48 };
      case SNOW:   return { r: 234, g: 240, b: 246 };
      case ROAD:   return { r: 188, g: 188, b: 196 };
      case ROOF:   return { r: 182, g: 62, b: 34 };
      default:     return { r: 40, g: 40, b: 46 };
    }
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
      this.stampVillagesAndRoads(chunk, cx, cz);
      this.applyMods(chunk, cx, cz);
      chunk.computeHeightMap();
      this.chunks.set(k, chunk);
    }
    return chunk;
  }

  private recordMod(cx: number, cz: number, lx: number, wy: number, lz: number, block: BlockId): void {
    const k = this.key(cx, cz);
    let m = this.mods.get(k);
    if (!m) { m = new Map(); this.mods.set(k, m); }
    m.set(`${lx},${wy},${lz}`, block);
  }

  private applyMods(chunk: VoxelChunk, cx: number, cz: number): void {
    const m = this.mods.get(this.key(cx, cz));
    if (!m) return;
    for (const [lk, block] of m) {
      const [lx, wy, lz] = lk.split(',').map(Number);
      if (wy < 0 || wy >= CHUNK_H) continue;
      chunk.set(lx, wy, lz, block);
    }
  }

  public serializeDiffs(): WorldDiffs {
    const out: WorldDiffs = {};
    for (const [chunkKey, m] of this.mods) {
      const entries: Array<[number, number, number, number]> = [];
      for (const [lk, block] of m) {
        const [lx, wy, lz] = lk.split(',').map(Number);
        entries.push([lx, wy, lz, block]);
      }
      if (entries.length > 0) out[chunkKey] = entries;
    }
    return out;
  }

  public loadDiffs(diffs: WorldDiffs): void {
    this.mods.clear();
    for (const [chunkKey, entries] of Object.entries(diffs)) {
      const m = new Map<string, BlockId>();
      for (const [lx, wy, lz, block] of entries) {
        m.set(`${lx},${wy},${lz}`, block);
      }
      this.mods.set(chunkKey, m);
    }
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

  private getVillage(rx: number, rz: number): Village | null {
    const r = deterministicRandom(rx, rz, this.seed ^ 0x51A1);
    if (r > VILLAGE_PROB) return null;
    const jx = deterministicRandom(rx, rz, this.seed ^ 0x51B2);
    const jz = deterministicRandom(rx, rz, this.seed ^ 0x51C3);
    const padding = Math.floor(CHUNK_W * 0.75);
    const inner = REGION_W - padding * 2;
    const x = rx * REGION_W + padding + Math.floor(jx * inner);
    const z = rz * REGION_W + padding + Math.floor(jz * inner);
    const naturalH = this.terrainHeight(x, z);
    if (naturalH <= SEA_LEVEL + 1 || naturalH >= SNOW_LINE) return null;
    const seed = Math.floor(deterministicRandom(rx, rz, this.seed ^ 0x51D4) * 1e9);
    return { rx, rz, x, z, floorY: naturalH, seed };
  }

  private getHouses(v: Village): House[] {
    const houses: House[] = [];
    // 8 diagonal positions — offset from cardinals so roads don't pass through houses
    for (let i = 0; i < 8; i++) {
      const skip = deterministicRandom(v.rx * 37 + i, v.rz * 41 + i, v.seed);
      if (skip < 0.3) continue;
      const angle = Math.PI / 8 + i * (Math.PI / 4);
      const distRaw = deterministicRandom(v.rx + i * 7, v.rz * 13, v.seed ^ 0x7A);
      const dist = 10 + Math.floor(distRaw * 5);
      const hx = v.x + Math.round(Math.cos(angle) * dist);
      const hz = v.z + Math.round(Math.sin(angle) * dist);
      const w = 5 + Math.floor(deterministicRandom(hx, hz, v.seed ^ 0x8B) * 2);
      const d = 5 + Math.floor(deterministicRandom(hz, hx, v.seed ^ 0x9C) * 2);
      houses.push({ x: hx, z: hz, w, d, floorY: v.floorY });
    }
    return houses;
  }

  private pointSegmentDist(
    px: number, pz: number,
    ax: number, az: number, bx: number, bz: number,
  ): { t: number; dist: number } {
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq === 0) return { t: 0, dist: Math.hypot(px - ax, pz - az) };
    let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const ex = ax + t * dx;
    const ez = az + t * dz;
    return { t, dist: Math.hypot(px - ex, pz - ez) };
  }

  private stampVillagesAndRoads(chunk: VoxelChunk, cx: number, cz: number): void {
    const worldX0 = cx * CHUNK_W;
    const worldZ0 = cz * CHUNK_W;
    const rx0 = Math.floor(cx / REGION_CHUNKS);
    const rz0 = Math.floor(cz / REGION_CHUNKS);

    const villages: Village[] = [];
    for (let drx = -1; drx <= 1; drx++) {
      for (let drz = -1; drz <= 1; drz++) {
        const v = this.getVillage(rx0 + drx, rz0 + drz);
        if (v) villages.push(v);
      }
    }
    if (villages.length === 0) return;

    const segments: Array<{ a: Village; b: Village }> = [];
    for (const v of villages) {
      for (const [drx, drz] of [[1, 0], [0, 1]] as const) {
        const nbr = villages.find(u => u.rx === v.rx + drx && u.rz === v.rz + drz);
        if (nbr) segments.push({ a: v, b: nbr });
      }
    }

    for (let lx = 0; lx < CHUNK_W; lx++) {
      for (let lz = 0; lz < CHUNK_W; lz++) {
        const wx = worldX0 + lx;
        const wz = worldZ0 + lz;

        let closestV: Village | null = null;
        let closestD = Infinity;
        for (const v of villages) {
          const d = Math.hypot(wx - v.x, wz - v.z);
          if (d < closestD) { closestD = d; closestV = v; }
        }

        let roadH = 0;
        let onRoad = false;
        for (const seg of segments) {
          const { t, dist } = this.pointSegmentDist(wx, wz, seg.a.x, seg.a.z, seg.b.x, seg.b.z);
          if (dist <= ROAD_HALF_WIDTH) {
            const h = Math.round(seg.a.floorY + (seg.b.floorY - seg.a.floorY) * t);
            if (!onRoad || h > roadH) { roadH = h; onRoad = true; }
          }
        }

        const inVillage = closestV !== null && closestD <= VILLAGE_RADIUS;

        let targetH: number;
        let topBlock: BlockId;
        if (onRoad) {
          targetH = roadH;
          topBlock = ROAD;
        } else if (inVillage && closestV) {
          targetH = closestV.floorY;
          topBlock = GRASS;
        } else {
          continue;
        }

        for (let y = 0; y < CHUNK_H; y++) {
          const cur = chunk.get(lx, y, lz);
          if (y < targetH - 1) {
            if (cur === AIR || cur === WOOD || cur === LEAVES) chunk.set(lx, y, lz, DIRT);
          } else if (y === targetH - 1) {
            chunk.set(lx, y, lz, topBlock);
          } else if (cur !== AIR) {
            chunk.set(lx, y, lz, AIR);
          }
        }
      }
    }

    for (const v of villages) {
      for (const house of this.getHouses(v)) {
        this.stampHouse(chunk, cx, cz, house);
      }
      this.stampFarm(chunk, cx, cz, v);
      this.stampConstructionInitial(chunk, cx, cz, v);
    }
  }

  private stampFarm(chunk: VoxelChunk, cx: number, cz: number, v: Village): void {
    const worldX0 = cx * CHUNK_W;
    const worldZ0 = cz * CHUNK_W;
    const centerX = v.x + FARM_OFFSET_X;
    const centerZ = v.z + FARM_OFFSET_Z;
    const halfW = Math.floor(FARM_W / 2);
    const halfD = Math.floor(FARM_D / 2);
    const surfaceY = v.floorY - 1;

    for (let dx = 0; dx < FARM_W; dx++) {
      for (let dz = 0; dz < FARM_D; dz++) {
        const wx = centerX - halfW + dx;
        const wz = centerZ - halfD + dz;
        const lx = wx - worldX0;
        const lz = wz - worldZ0;
        if (lx < 0 || lx >= CHUNK_W || lz < 0 || lz >= CHUNK_W) continue;

        // Alternating DIRT rows with GRASS furrows between them (rows along X)
        const isDirtRow = (dz % 2) === 0;
        const topBlock = isDirtRow ? DIRT : GRASS;

        if (surfaceY >= 0 && surfaceY < CHUNK_H) {
          chunk.set(lx, surfaceY, lz, topBlock);
        }
        // Clear air above
        for (let y = v.floorY; y < CHUNK_H; y++) {
          if (chunk.get(lx, y, lz) !== AIR) chunk.set(lx, y, lz, AIR);
        }
      }
    }
  }

  private stampConstructionInitial(chunk: VoxelChunk, cx: number, cz: number, v: Village): void {
    const worldX0 = cx * CHUNK_W;
    const worldZ0 = cz * CHUNK_W;
    const plan = this.getConstructionPlan(v);

    for (let i = 0; i < plan.length; i++) {
      // Deterministic per block: "initial" if hash falls below fraction
      const r = deterministicRandom(plan[i].wx, plan[i].wz * 31 + plan[i].wy, v.seed);
      if (r > SITE_INITIAL_FRACTION) continue;
      const b = plan[i];
      const lx = b.wx - worldX0;
      const lz = b.wz - worldZ0;
      if (lx < 0 || lx >= CHUNK_W || lz < 0 || lz >= CHUNK_W) continue;
      if (b.wy < 0 || b.wy >= CHUNK_H) continue;
      chunk.set(lx, b.wy, lz, b.block);
    }
  }

  private stampHouse(chunk: VoxelChunk, cx: number, cz: number, house: House): void {
    const worldX0 = cx * CHUNK_W;
    const worldZ0 = cz * CHUNK_W;
    const halfW = Math.floor(house.w / 2);
    const halfD = Math.floor(house.d / 2);
    const minX = house.x - halfW;
    const maxX = house.x + halfW;
    const minZ = house.z - halfD;
    const maxZ = house.z + halfD;

    if (maxX < worldX0 || minX >= worldX0 + CHUNK_W) return;
    if (maxZ < worldZ0 || minZ >= worldZ0 + CHUNK_W) return;

    const wallTop = house.floorY + 3;

    for (let wx = minX; wx <= maxX; wx++) {
      for (let wz = minZ; wz <= maxZ; wz++) {
        const lx = wx - worldX0;
        const lz = wz - worldZ0;
        if (lx < 0 || lx >= CHUNK_W || lz < 0 || lz >= CHUNK_W) continue;
        const isEdge = wx === minX || wx === maxX || wz === minZ || wz === maxZ;
        if (isEdge) {
          for (let y = house.floorY; y <= wallTop; y++) {
            if (y >= CHUNK_H) break;
            chunk.set(lx, y, lz, WOOD);
          }
        } else {
          for (let y = house.floorY; y <= wallTop; y++) {
            if (y >= CHUNK_H) break;
            chunk.set(lx, y, lz, AIR);
          }
        }
      }
    }

    // Stepped pyramid roof
    const maxStep = Math.min(halfW, halfD);
    for (let step = 0; step <= maxStep; step++) {
      const y = wallTop + 1 + step;
      if (y >= CHUNK_H) break;
      const sx0 = minX + step;
      const sx1 = maxX - step;
      const sz0 = minZ + step;
      const sz1 = maxZ - step;
      for (let wx = sx0; wx <= sx1; wx++) {
        for (let wz = sz0; wz <= sz1; wz++) {
          const lx = wx - worldX0;
          const lz = wz - worldZ0;
          if (lx < 0 || lx >= CHUNK_W || lz < 0 || lz >= CHUNK_W) continue;
          chunk.set(lx, y, lz, ROOF);
        }
      }
    }

    // Door (south-facing)
    const dlx = house.x - worldX0;
    const dlz = maxZ - worldZ0;
    if (dlx >= 0 && dlx < CHUNK_W && dlz >= 0 && dlz < CHUNK_W) {
      chunk.set(dlx, house.floorY, dlz, AIR);
      chunk.set(dlx, house.floorY + 1, dlz, AIR);
    }
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

  private rebuildChunkMeshLOD1(cx: number, cz: number, chunk: VoxelChunk): void {
    const key = this.key(cx, cz);
    const group = this.chunkGroupsLOD1.get(key);
    if (!group) return;

    for (const child of group.children.slice()) {
      group.remove(child);
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry.dispose();
      }
    }

    const mesh = this.buildChunkMeshLOD1(chunk, cx, cz);
    if (mesh) group.add(mesh);
  }

  private buildChunkMeshLOD1(chunk: VoxelChunk, cx: number, cz: number): THREE.Mesh | null {
    const w = chunk.lod1SizeX;
    const h = chunk.lod1SizeY;
    const d = chunk.lod1SizeZ;

    const getVoxel = (x: number, y: number, z: number): BlockId => {
      if (y < 0 || y >= h) return AIR;
      if (x < 0) {
        const n = this.chunks.get(this.key(cx - 1, cz));
        return n ? n.getLOD1(w - 1, y, z) : AIR;
      }
      if (x >= w) {
        const n = this.chunks.get(this.key(cx + 1, cz));
        return n ? n.getLOD1(0, y, z) : AIR;
      }
      if (z < 0) {
        const n = this.chunks.get(this.key(cx, cz - 1));
        return n ? n.getLOD1(x, y, d - 1) : AIR;
      }
      if (z >= d) {
        const n = this.chunks.get(this.key(cx, cz + 1));
        return n ? n.getLOD1(x, y, 0) : AIR;
      }
      return chunk.getLOD1(x, y, z);
    };

    const geometry = buildChunkGeometry(getVoxel, [w, h, d]);
    if (!geometry) return null;

    const mesh = new THREE.Mesh(geometry, this.chunkMaterial);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
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
