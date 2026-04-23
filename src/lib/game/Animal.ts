import * as THREE from 'three';

export type AnimalKind = 'chicken' | 'pig' | 'deer';

interface AnimalParams {
  walkSpeed: number;
  fleeSpeed: number;
  wanderRadius: number;
  fleeDistance: number;
  collisionRadius: number;
}

export class Animal {
  public readonly kind: AnimalKind;
  private readonly group: THREE.Group;
  private readonly legs: THREE.Object3D[];
  private readonly position: THREE.Vector3;
  private home: THREE.Vector3;
  private target: THREE.Vector3 | null = null;
  private waitTime = 0;
  private fleeTimer = 0;
  private alive = true;
  private legPhase = 0;
  private facing = 0;
  private readonly params: AnimalParams;

  constructor(
    kind: AnimalKind,
    home: THREE.Vector3,
    group: THREE.Group,
    legs: THREE.Object3D[],
    params: AnimalParams,
  ) {
    this.kind = kind;
    this.home = home.clone();
    this.position = home.clone();
    this.group = group;
    this.legs = legs;
    this.params = params;
    this.group.position.copy(this.position);
  }

  public getGroup(): THREE.Group { return this.group; }
  public getPosition(): THREE.Vector3 { return this.position; }
  public isAlive(): boolean { return this.alive; }
  public destroy(): void { this.alive = false; }
  public getCollisionRadius(): number { return this.params.collisionRadius; }
  public setHome(home: THREE.Vector3): void { this.home.copy(home); }

  public update(
    deltaTime: number,
    playerPos: THREE.Vector3,
    getGroundY: (x: number, z: number) => number,
  ): void {
    if (!this.alive) return;

    const dxP = this.position.x - playerPos.x;
    const dzP = this.position.z - playerPos.z;
    const distToPlayerSq = dxP * dxP + dzP * dzP;
    if (distToPlayerSq < this.params.fleeDistance * this.params.fleeDistance) {
      this.fleeTimer = 2.5;
    }

    const isFleeing = this.fleeTimer > 0;
    const speed = isFleeing ? this.params.fleeSpeed : this.params.walkSpeed;

    if (isFleeing) {
      this.fleeTimer -= deltaTime;
      const d = Math.sqrt(distToPlayerSq) || 1;
      const fx = dxP / d;
      const fz = dzP / d;
      this.target = new THREE.Vector3(this.position.x + fx * 5, 0, this.position.z + fz * 5);
      this.waitTime = 0;
    } else if (!this.target || this.horizDistTo(this.target) < 0.8) {
      if (this.waitTime > 0) {
        this.waitTime -= deltaTime;
        this.target = null;
      } else {
        this.waitTime = 1 + Math.random() * 3;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * this.params.wanderRadius;
        this.target = new THREE.Vector3(
          this.home.x + Math.cos(angle) * r,
          0,
          this.home.z + Math.sin(angle) * r,
        );
      }
    }

    const moving = this.target !== null && (isFleeing || this.waitTime <= 0);
    if (moving && this.target) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        this.position.x += (dx / len) * speed * deltaTime;
        this.position.z += (dz / len) * speed * deltaTime;
        this.legPhase += deltaTime * speed * 2.5;
        this.facing = Math.atan2(dx, dz);
      }
    }

    this.position.y = getGroundY(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    if (moving) {
      for (let i = 0; i < this.legs.length; i++) {
        const phase = this.legPhase + (i % 2 === 0 ? 0 : Math.PI);
        this.legs[i].rotation.x = Math.sin(phase) * 0.55;
      }
    } else {
      for (const leg of this.legs) leg.rotation.x *= 0.85;
    }
  }

  private horizDistTo(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }
}

function makeLegPivot(
  material: THREE.Material,
  hipPos: [number, number, number],
  legSize: [number, number, number],
): THREE.Object3D {
  const pivot = new THREE.Group();
  pivot.position.set(...hipPos);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(...legSize), material);
  leg.position.y = -legSize[1] / 2;
  leg.castShadow = true;
  pivot.add(leg);
  return pivot;
}

export function createChicken(home: THREE.Vector3): Animal {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xfafaf0 });
  const beakMat = new THREE.MeshLambertMaterial({ color: 0xf3a847 });
  const combMat = new THREE.MeshLambertMaterial({ color: 0xc2262e });
  const legMat = new THREE.MeshLambertMaterial({ color: 0xd89040 });

  const legs = [
    makeLegPivot(legMat, [-0.12, 0.3, 0], [0.08, 0.3, 0.08]),
    makeLegPivot(legMat, [0.12, 0.3, 0], [0.08, 0.3, 0.08]),
  ];
  for (const leg of legs) group.add(leg);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.6), body);
  torso.position.y = 0.55;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), body);
  head.position.set(0, 0.95, 0.28);
  head.castShadow = true;
  group.add(head);

  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.14), beakMat);
  beak.position.set(0, 0.92, 0.48);
  group.add(beak);

  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.18), combMat);
  comb.position.set(0, 1.16, 0.28);
  group.add(comb);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.15), body);
  tail.position.set(0, 0.68, -0.35);
  tail.rotation.x = 0.3;
  group.add(tail);

  return new Animal('chicken', home, group, legs, {
    walkSpeed: 1.6, fleeSpeed: 5.5, wanderRadius: 6, fleeDistance: 5, collisionRadius: 0.4,
  });
}

export function createPig(home: THREE.Vector3): Animal {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xebaaa4 });
  const snoutMat = new THREE.MeshLambertMaterial({ color: 0xc88b83 });

  const legs = [
    makeLegPivot(body, [-0.3, 0.4, 0.5], [0.2, 0.4, 0.2]),
    makeLegPivot(body, [0.3, 0.4, 0.5], [0.2, 0.4, 0.2]),
    makeLegPivot(body, [-0.3, 0.4, -0.5], [0.2, 0.4, 0.2]),
    makeLegPivot(body, [0.3, 0.4, -0.5], [0.2, 0.4, 0.2]),
  ];
  for (const leg of legs) group.add(leg);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 1.4), body);
  torso.position.y = 0.8;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.55), body);
  head.position.set(0, 0.85, 0.9);
  head.castShadow = true;
  group.add(head);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.18), snoutMat);
  snout.position.set(0, 0.72, 1.22);
  group.add(snout);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), body);
  tail.position.set(0, 0.98, -0.72);
  tail.rotation.x = -0.4;
  group.add(tail);

  return new Animal('pig', home, group, legs, {
    walkSpeed: 1.2, fleeSpeed: 3.5, wanderRadius: 7, fleeDistance: 5, collisionRadius: 0.7,
  });
}

export function createDeer(home: THREE.Vector3): Animal {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0x9c6c3b });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xfafaf0 });
  const antlerMat = new THREE.MeshLambertMaterial({ color: 0x4a3417 });

  const legs = [
    makeLegPivot(body, [-0.27, 0.9, 0.55], [0.16, 0.9, 0.16]),
    makeLegPivot(body, [0.27, 0.9, 0.55], [0.16, 0.9, 0.16]),
    makeLegPivot(body, [-0.27, 0.9, -0.55], [0.16, 0.9, 0.16]),
    makeLegPivot(body, [0.27, 0.9, -0.55], [0.16, 0.9, 0.16]),
  ];
  for (const leg of legs) group.add(leg);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.7, 1.4), body);
  torso.position.y = 1.25;
  torso.castShadow = true;
  group.add(torso);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.75, 0.4), body);
  neck.position.set(0, 1.65, 0.8);
  neck.rotation.x = -0.3;
  neck.castShadow = true;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.55), body);
  head.position.set(0, 1.95, 1.15);
  head.castShadow = true;
  group.add(head);

  for (const side of [-1, 1]) {
    const antler = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.07), antlerMat);
    antler.position.set(side * 0.14, 2.22, 1.1);
    group.add(antler);
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.07), antlerMat);
    prong.position.set(side * 0.22, 2.32, 1.2);
    prong.rotation.z = side * -0.4;
    group.add(prong);
  }

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.14), tailMat);
  tail.position.set(0, 1.3, -0.78);
  group.add(tail);

  return new Animal('deer', home, group, legs, {
    walkSpeed: 2.5, fleeSpeed: 8, wanderRadius: 14, fleeDistance: 9, collisionRadius: 0.7,
  });
}
