import * as THREE from 'three';

// The player's controllable friend — a villager-like figure that loosely
// follows the player and, on a typed command, walks off to gather a resource
// and carry it back. Behaviour is driven entirely by a CompanionContext so
// this class stays free of world/inventory knowledge.

export type GatherType = 'meat' | 'wood' | 'stone';

export type CarryLoad =
  | { kind: 'meat'; count: number }
  | { kind: 'blocks'; entries: Array<[number, number]> }; // [blockId, count]

export interface CompanionContext {
  getPlayerPos: () => THREE.Vector3;
  getGroundY: (x: number, z: number) => number;
  // Where to go to gather `type`, near `from`; null if nothing is in range.
  findTarget: (type: GatherType, from: THREE.Vector3) => THREE.Vector3 | null;
  // Remove the resource from the world at `at`; returns what was carried off.
  harvest: (type: GatherType, at: THREE.Vector3) => CarryLoad | null;
  // Hand the load to the player; returns a short result message.
  deliver: (load: CarryLoad) => string;
  showMessage: (text: string) => void;
}

type State = 'idle' | 'to-resource' | 'harvesting' | 'returning';

const SHIRT = 0x2f6db0;      // friendly blue so your buddy stands out
const SHIRT_DARK = 0x24527f;
const SKIN = 0xe3b58a;
const FACE = 0x2a2018;

const FOLLOW_SPEED = 2.6;
const TASK_SPEED = 3.2;
const FOLLOW_RANGE = 4;      // an idle companion catches up once further than this
const ARRIVE_RESOURCE = 0.5;
const ARRIVE_PLAYER = 1.8;
const HARVEST_TIME = 1.5;

const scratch = new THREE.Vector3();

export class Companion {
  private readonly group = new THREE.Group();
  private readonly position = new THREE.Vector3();
  private facing = 0;
  private animTime = Math.random() * 10;
  private readonly ctx: CompanionContext;

  private readonly leftLeg: THREE.Object3D;
  private readonly rightLeg: THREE.Object3D;
  private readonly leftArm: THREE.Object3D;
  private readonly rightArm: THREE.Object3D;
  private carriedMesh: THREE.Mesh | null = null;

  private state: State = 'idle';
  private gatherType: GatherType | null = null;
  private target: THREE.Vector3 | null = null;
  private harvestTimer = 0;
  private carrying: CarryLoad | null = null;

  constructor(spawn: THREE.Vector3, ctx: CompanionContext) {
    this.position.copy(spawn);
    this.ctx = ctx;

    const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
    const shirtMat = new THREE.MeshLambertMaterial({ color: SHIRT });
    const pantsMat = new THREE.MeshLambertMaterial({ color: SHIRT_DARK });

    this.leftLeg = this.makePivot([-0.12, 0.55, 0], [0.2, 0.55, 0.2], pantsMat);
    this.rightLeg = this.makePivot([0.12, 0.55, 0], [0.2, 0.55, 0.2], pantsMat);
    this.group.add(this.leftLeg, this.rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), shirtMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    this.group.add(torso);

    this.leftArm = this.makePivot([-0.35, 1.15, 0], [0.16, 0.6, 0.16], skinMat);
    this.rightArm = this.makePivot([0.35, 1.15, 0], [0.16, 0.6, 0.16], skinMat);
    this.group.add(this.leftArm, this.rightArm);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    head.position.y = 1.5;
    head.castShadow = true;
    const faceMat = new THREE.MeshLambertMaterial({ color: FACE });
    const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), faceMat);
    leftEye.position.set(-0.1, 0.05, 0.2);
    const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), faceMat);
    rightEye.position.set(0.1, 0.05, 0.2);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.04), faceMat);
    mouth.position.set(0, -0.1, 0.2);
    head.add(leftEye, rightEye, mouth);
    this.group.add(head);

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
  public isBusy(): boolean { return this.state !== 'idle'; }

  // Issued when the player types an a/b/c command. Interrupts whatever the
  // companion was doing and starts a fresh gather job.
  public command(type: GatherType): void {
    this.gatherType = type;
    this.carrying = null;
    this.setCarried(null);
    this.target = this.ctx.findTarget(type, this.position);
    if (!this.target) {
      this.ctx.showMessage(`Companion: no ${type} nearby.`);
      this.state = 'idle';
      return;
    }
    this.state = 'to-resource';
    this.ctx.showMessage(`Companion: fetching ${type}...`);
  }

  public update(deltaTime: number): void {
    this.animTime += deltaTime;
    const playerPos = this.ctx.getPlayerPos();
    let walking = false;
    let working = false;

    switch (this.state) {
      case 'idle':
        if (this.distanceTo(playerPos) > FOLLOW_RANGE) {
          walking = this.walkToward(playerPos, FOLLOW_SPEED * deltaTime, FOLLOW_RANGE * 0.6);
        }
        break;

      case 'to-resource':
        if (!this.target) { this.state = 'idle'; break; }
        walking = this.walkToward(this.target, TASK_SPEED * deltaTime, ARRIVE_RESOURCE);
        if (!walking) {
          this.state = 'harvesting';
          this.harvestTimer = HARVEST_TIME;
        }
        break;

      case 'harvesting':
        working = true;
        this.harvestTimer -= deltaTime;
        if (this.harvestTimer <= 0) {
          const load = this.target && this.gatherType
            ? this.ctx.harvest(this.gatherType, this.target)
            : null;
          if (load) {
            this.carrying = load;
            this.setCarried(load);
            this.state = 'returning';
          } else {
            this.ctx.showMessage(`Companion: nothing to gather here.`);
            this.state = 'idle';
          }
        }
        break;

      case 'returning':
        walking = this.walkToward(playerPos, TASK_SPEED * deltaTime, ARRIVE_PLAYER);
        if (!walking) {
          if (this.carrying) {
            this.ctx.showMessage(this.ctx.deliver(this.carrying));
            this.carrying = null;
            this.setCarried(null);
          }
          this.state = 'idle';
        }
        break;
    }

    this.position.y = this.ctx.getGroundY(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
    this.animate(walking, working);
  }

  private distanceTo(p: THREE.Vector3): number {
    return scratch.subVectors(this.position, p).setY(0).length();
  }

  private walkToward(target: THREE.Vector3, maxStep: number, arriveDist = 0.4): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= arriveDist) return false;
    const step = Math.min(maxStep, dist);
    this.position.x += (dx / dist) * step;
    this.position.z += (dz / dist) * step;
    this.facing = Math.atan2(dx, dz);
    return true;
  }

  private setCarried(load: CarryLoad | null): void {
    if (this.carriedMesh) {
      this.group.remove(this.carriedMesh);
      this.carriedMesh.geometry.dispose();
      (this.carriedMesh.material as THREE.Material).dispose();
      this.carriedMesh = null;
    }
    if (!load) return;
    const color = load.kind === 'meat' ? 0xb5462f : 0x8a6a3a;
    this.carriedMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.28),
      new THREE.MeshLambertMaterial({ color }),
    );
    this.carriedMesh.position.set(0.32, 1.12, 0.24);
    this.carriedMesh.castShadow = true;
    this.group.add(this.carriedMesh);
  }

  private animate(walking: boolean, working: boolean): void {
    if (walking) {
      const swing = Math.sin(this.animTime * 7) * 0.5;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.8;
      this.rightArm.rotation.x = swing * 0.8;
    } else if (working) {
      for (const leg of [this.leftLeg, this.rightLeg]) leg.rotation.x *= 0.85;
      // Both arms chop down together.
      const chop = (Math.sin(this.animTime * 10) * 0.5 - 0.5) * 0.9;
      this.leftArm.rotation.x = chop;
      this.rightArm.rotation.x = chop;
    } else {
      for (const limb of [this.leftLeg, this.rightLeg, this.leftArm, this.rightArm]) {
        limb.rotation.x *= 0.9;
      }
    }
  }
}
