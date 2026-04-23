import * as THREE from 'three';
import { ROOF, WOOD, type BlockId } from './voxel/BlockTypes';

export type Profession = 'farmer' | 'hunter' | 'lumberjack' | 'stonecutter' | 'builder';
export type Resource = 'lumber' | 'stone' | 'food';

export interface VillageEconomy {
  lumber: number;
  stone: number;
  food: number;
  money: number;
}

export interface PlanBlock {
  wx: number;
  wy: number;
  wz: number;
  block: BlockId;
}

export interface VillagerContext {
  economy: VillageEconomy;
  getWorkSpot: (profession: Profession) => THREE.Vector3;
  placeBlock?: (b: PlanBlock) => boolean;
  pendingBlocks?: PlanBlock[];
  huntNearby?: (pos: THREE.Vector3, range: number) => boolean;
}

const PROFESSION_BODY_COLOR: Record<Profession, number> = {
  farmer: 0x6a8f45,
  hunter: 0x3e5b38,
  lumberjack: 0x6b4524,
  stonecutter: 0x55606c,
  builder: 0xc9a13a,
};

const RESOURCE_COLOR: Record<Resource, number> = {
  food: 0xd96a28,
  lumber: 0x8a5a2d,
  stone: 0x9fa0a3,
};

const DEPOSIT_PRICE: Record<Resource, number> = {
  food: 1,
  lumber: 2,
  stone: 3,
};

const HUNGER_RATE = 0.012;
const HUNGER_EAT_THRESHOLD = 0.55;

const scratch = new THREE.Vector3();

function blockToResource(block: BlockId): Resource | null {
  if (block === WOOD) return 'lumber';
  if (block === ROOF) return 'stone';
  return null;
}

function producerForResource(r: Resource): Profession {
  if (r === 'lumber') return 'lumberjack';
  if (r === 'stone') return 'stonecutter';
  return 'hunter';
}

type State = 'resting' | 'going-to-work' | 'working' | 'going-home';

export class Villager {
  public readonly primaryProfession: Profession;
  public profession: Profession;
  private state: State = 'resting';
  private stateTimer: number;
  private animTime = 0;
  private workTimer = 0;
  private buildCooldown = 0;
  private hunger = 0;
  private inventory: { type: Resource; count: number } | null = null;
  private facing = 0;
  private workspot: THREE.Vector3;

  private readonly position: THREE.Vector3;
  private readonly home: THREE.Vector3;
  private readonly group: THREE.Group;
  private readonly leftLeg: THREE.Object3D;
  private readonly rightLeg: THREE.Object3D;
  private readonly leftArm: THREE.Object3D;
  private readonly rightArm: THREE.Object3D;
  private readonly shirtMat: THREE.MeshLambertMaterial;
  private carriedMesh: THREE.Mesh | null = null;

  private readonly ctx: VillagerContext;

  constructor(primaryProfession: Profession, home: THREE.Vector3, ctx: VillagerContext) {
    this.primaryProfession = primaryProfession;
    this.profession = primaryProfession;
    this.home = home.clone();
    this.position = home.clone();
    this.ctx = ctx;
    this.stateTimer = Math.random() * 3;
    this.workspot = ctx.getWorkSpot(primaryProfession).clone();

    this.group = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xe3b58a });
    this.shirtMat = new THREE.MeshLambertMaterial({ color: PROFESSION_BODY_COLOR[primaryProfession] });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x4c3b22 });
    const hatMat = new THREE.MeshLambertMaterial({ color: 0x3a2a18 });

    this.leftLeg = this.makePivot([-0.12, 0.55, 0], [0.2, 0.55, 0.2], pantsMat);
    this.rightLeg = this.makePivot([0.12, 0.55, 0], [0.2, 0.55, 0.2], pantsMat);
    this.group.add(this.leftLeg, this.rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), this.shirtMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    this.group.add(torso);

    this.leftArm = this.makePivot([-0.35, 1.15, 0], [0.16, 0.6, 0.16], skinMat);
    this.rightArm = this.makePivot([0.35, 1.15, 0], [0.16, 0.6, 0.16], skinMat);
    this.group.add(this.leftArm, this.rightArm);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    head.position.y = 1.5;
    head.castShadow = true;
    this.group.add(head);

    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), hatMat);
    hat.position.y = 1.76;
    this.group.add(hat);

    const hatTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), hatMat);
    hatTop.position.y = 1.9;
    this.group.add(hatTop);

    this.group.position.copy(this.position);
  }

  private makePivot(
    pos: [number, number, number],
    size: [number, number, number],
    mat: THREE.Material,
  ): THREE.Object3D {
    const pivot = new THREE.Group();
    pivot.position.set(...pos);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.y = -size[1] / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }

  public getGroup(): THREE.Group { return this.group; }
  public getPosition(): THREE.Vector3 { return this.position; }
  public getHunger(): number { return this.hunger; }
  public getInventory() { return this.inventory; }

  public distanceTo(p: THREE.Vector3): number {
    return scratch.subVectors(this.position, p).setY(0).length();
  }

  public update(deltaTime: number, getGroundY: (x: number, z: number) => number): void {
    this.hunger = Math.min(1, this.hunger + deltaTime * HUNGER_RATE);

    let walking = false;
    let working = false;

    switch (this.state) {
      case 'resting':
        this.stateTimer -= deltaTime;
        if (this.stateTimer <= 0) this.decideNextCycle();
        break;

      case 'going-to-work':
        walking = this.walkToward(this.workspot, 1.8 * deltaTime);
        if (!walking) {
          this.state = 'working';
          this.workTimer = this.getWorkDuration();
          this.buildCooldown = 0;
        }
        break;

      case 'working':
        this.workTimer -= deltaTime;
        working = true;
        this.performWorkAction(deltaTime);
        if (this.workTimer <= 0 || this.shouldAbortWork()) {
          this.state = 'going-home';
        }
        break;

      case 'going-home':
        walking = this.walkToward(this.home, 1.8 * deltaTime);
        if (!walking) {
          this.onArriveHome();
          this.state = 'resting';
          this.stateTimer = 2 + Math.random() * 3;
        }
        break;
    }

    this.position.y = getGroundY(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
    this.animate(deltaTime, walking, working);
  }

  private decideNextCycle(): void {
    // Try to eat if hungry
    if (this.hunger > HUNGER_EAT_THRESHOLD && this.ctx.economy.food > 0) {
      this.ctx.economy.food--;
      this.ctx.economy.money = Math.max(0, this.ctx.economy.money - 1);
      this.hunger = 0;
    }

    // Pick profession for this cycle
    if (this.primaryProfession === 'builder') {
      const next = this.ctx.pendingBlocks?.[0];
      if (next) {
        const needed = blockToResource(next.block);
        if (needed && this.ctx.economy[needed] < 1) {
          this.profession = producerForResource(needed);
        } else {
          this.profession = 'builder';
        }
      } else {
        this.profession = 'builder';
      }
    } else {
      this.profession = this.primaryProfession;
    }
    this.shirtMat.color.setHex(PROFESSION_BODY_COLOR[this.profession]);

    this.workspot = this.ctx.getWorkSpot(this.profession).clone();
    this.state = 'going-to-work';
  }

  private getWorkDuration(): number {
    if (this.profession === 'builder') return 10 + Math.random() * 4;
    if (this.profession === 'hunter') return 12 + Math.random() * 4;
    return 6 + Math.random() * 3;
  }

  private shouldAbortWork(): boolean {
    if (this.profession === 'builder') {
      const next = this.ctx.pendingBlocks?.[0];
      if (!next) return true;
      const res = blockToResource(next.block);
      if (res && this.ctx.economy[res] < 1) return true;
    }
    if (this.inventory && this.profession !== 'builder') {
      // already got goods → head home early
      return this.workTimer < this.getWorkDuration() - 0.5;
    }
    return false;
  }

  private performWorkAction(deltaTime: number): void {
    // Face workspot while working
    const dx = this.workspot.x - this.position.x;
    const dz = this.workspot.z - this.position.z;
    if (Math.hypot(dx, dz) > 0.1) this.facing = Math.atan2(dx, dz);

    switch (this.profession) {
      case 'builder':
        this.tickBuilder(deltaTime);
        break;
      case 'hunter':
        this.tickHunter();
        break;
      case 'farmer':
        this.tickGenericProducer('food', 4);
        break;
      case 'lumberjack':
        this.tickGenericProducer('lumber', 5);
        break;
      case 'stonecutter':
        this.tickGenericProducer('stone', 6);
        break;
    }
  }

  private tickBuilder(deltaTime: number): void {
    if (!this.ctx.pendingBlocks || !this.ctx.placeBlock) return;
    this.buildCooldown -= deltaTime;
    if (this.buildCooldown > 0) return;

    const next = this.ctx.pendingBlocks[0];
    if (!next) { this.workTimer = 0; return; }

    const res = blockToResource(next.block);
    if (!res || this.ctx.economy[res] < 1) { this.workTimer = 0; return; }

    const ok = this.ctx.placeBlock(next);
    if (ok) {
      this.ctx.economy[res]--;
      this.ctx.pendingBlocks.shift();
      this.buildCooldown = 2 + Math.random() * 1.5;
    } else {
      this.buildCooldown = 0.8;
    }
  }

  private tickHunter(): void {
    if (this.inventory || !this.ctx.huntNearby) return;
    if (this.ctx.huntNearby(this.position, 4.5)) {
      this.setInventory({ type: 'food', count: 1 });
    }
  }

  private tickGenericProducer(resource: Resource, duration: number): void {
    if (this.inventory) return;
    const elapsed = this.getWorkDuration() - this.workTimer;
    if (elapsed >= duration) {
      this.setInventory({ type: resource, count: 1 });
    }
  }

  private setInventory(inv: { type: Resource; count: number } | null): void {
    this.inventory = inv;
    this.refreshCarriedMesh();
  }

  private refreshCarriedMesh(): void {
    if (this.carriedMesh) {
      this.group.remove(this.carriedMesh);
      this.carriedMesh.geometry.dispose();
      (this.carriedMesh.material as THREE.Material).dispose();
      this.carriedMesh = null;
    }
    if (!this.inventory) return;
    const color = RESOURCE_COLOR[this.inventory.type];
    const size = this.inventory.type === 'lumber' ? 0.6 : 0.3;
    const geom = this.inventory.type === 'lumber'
      ? new THREE.BoxGeometry(0.18, 0.18, size)
      : new THREE.BoxGeometry(size, size, size);
    this.carriedMesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color }));
    this.carriedMesh.position.set(0.35, 1.15, 0.25);
    this.group.add(this.carriedMesh);
  }

  private onArriveHome(): void {
    if (this.inventory) {
      this.ctx.economy[this.inventory.type] += this.inventory.count;
      this.ctx.economy.money += DEPOSIT_PRICE[this.inventory.type] * this.inventory.count;
      this.setInventory(null);
    }
  }

  private walkToward(target: THREE.Vector3, maxStep: number): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) return false;
    const step = Math.min(maxStep, dist);
    this.position.x += (dx / dist) * step;
    this.position.z += (dz / dist) * step;
    this.facing = Math.atan2(dx, dz);
    return true;
  }

  private animate(deltaTime: number, walking: boolean, working: boolean): void {
    this.animTime += deltaTime;

    if (walking) {
      const phase = this.animTime * 7;
      const swing = Math.sin(phase) * 0.5;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.8;
      this.rightArm.rotation.x = swing * 0.8;
    } else if (working) {
      for (const leg of [this.leftLeg, this.rightLeg]) leg.rotation.x *= 0.85;
      const phase = this.animTime * 5;

      switch (this.profession) {
        case 'builder':
        case 'lumberjack':
        case 'stonecutter': {
          const swing = (Math.sin(phase * 2) * 0.5 - 0.5) * 0.9;
          this.leftArm.rotation.x = swing;
          this.rightArm.rotation.x = swing;
          break;
        }
        case 'farmer': {
          const swing = Math.sin(phase) * 0.3 - 0.6;
          this.leftArm.rotation.x = swing;
          this.rightArm.rotation.x = swing - 0.2;
          break;
        }
        case 'hunter': {
          this.leftArm.rotation.x = -1.2;
          this.rightArm.rotation.x = -1.0;
          break;
        }
      }
    } else {
      for (const limb of [this.leftLeg, this.rightLeg, this.leftArm, this.rightArm]) {
        limb.rotation.x *= 0.9;
      }
    }
  }
}
