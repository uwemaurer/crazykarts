import * as THREE from 'three';

// A box-built humanoid in an orange jumpsuit, used for the jail cells of the
// police fortresses. Two idle poses — standing at the bars looking out, or
// sitting on the bunk — plus a simple walk-to-target used by the quest giver
// when the player engages it. Modelled on Villager's mesh/animation approach
// but without any of the economy/work behaviour.

export type PrisonerPose = 'stand' | 'sit';

const JUMPSUIT = 0xd9772a;
const JUMPSUIT_DARK = 0xb45f1f;
const SKIN = 0xe3b58a;

export class Prisoner {
  private readonly group = new THREE.Group();
  private readonly position = new THREE.Vector3();
  private facing: number;
  private pose: PrisonerPose;
  private animTime = Math.random() * 10;
  private readonly idlePhase = Math.random() * Math.PI * 2;

  private readonly leftLeg: THREE.Object3D;
  private readonly rightLeg: THREE.Object3D;
  private readonly leftArm: THREE.Object3D;
  private readonly rightArm: THREE.Object3D;
  private readonly head: THREE.Object3D;

  private walkTarget: THREE.Vector3 | null = null;
  private arrived = false;

  constructor(position: THREE.Vector3, facing: number, pose: PrisonerPose) {
    this.position.copy(position);
    this.facing = facing;
    this.pose = pose;

    const suitMat = new THREE.MeshLambertMaterial({ color: JUMPSUIT });
    const suitDarkMat = new THREE.MeshLambertMaterial({ color: JUMPSUIT_DARK });
    const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });

    this.leftLeg = this.makePivot([-0.12, 0.55, 0], [0.2, 0.55, 0.2], suitDarkMat);
    this.rightLeg = this.makePivot([0.12, 0.55, 0], [0.2, 0.55, 0.2], suitDarkMat);
    this.group.add(this.leftLeg, this.rightLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), suitMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    this.group.add(torso);

    this.leftArm = this.makePivot([-0.35, 1.15, 0], [0.16, 0.6, 0.16], suitMat);
    this.rightArm = this.makePivot([0.35, 1.15, 0], [0.16, 0.6, 0.16], suitMat);
    this.group.add(this.leftArm, this.rightArm);

    // Head wrapped in a pivot so the idle look-around rotates it cleanly.
    this.head = new THREE.Group();
    this.head.position.y = 1.5;
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    this.group.add(this.head);

    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
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
  public setFacing(f: number): void { this.facing = f; }
  public hasArrived(): boolean { return this.arrived; }

  // Sends the prisoner walking toward a spot (the quest giver uses this to
  // step up to the bars when engaged). Switches to the standing pose.
  public walkTo(target: THREE.Vector3): void {
    this.walkTarget = target.clone();
    this.arrived = false;
    this.pose = 'stand';
  }

  public update(deltaTime: number, getGroundY: (x: number, z: number) => number): void {
    this.animTime += deltaTime;

    let walking = false;
    if (this.walkTarget) {
      const dx = this.walkTarget.x - this.position.x;
      const dz = this.walkTarget.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) {
        this.walkTarget = null;
        this.arrived = true;
      } else {
        const step = Math.min(1.5 * deltaTime, dist);
        this.position.x += (dx / dist) * step;
        this.position.z += (dz / dist) * step;
        this.facing = Math.atan2(dx, dz);
        walking = true;
      }
    }

    this.position.y = getGroundY(this.position.x, this.position.z);
    // Sitting lifts the body onto the bunk edge.
    const yOffset = this.pose === 'sit' && !walking ? 0.28 : 0;
    this.group.position.set(this.position.x, this.position.y + yOffset, this.position.z);
    this.group.rotation.y = this.facing;

    this.animate(walking);
  }

  private animate(walking: boolean): void {
    if (walking) {
      const phase = this.animTime * 7;
      const swing = Math.sin(phase) * 0.5;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.8;
      this.rightArm.rotation.x = swing * 0.8;
      this.head.rotation.y *= 0.8;
      this.group.rotation.z = 0;
      return;
    }

    // Slow side-to-side look-around, shared by both idle poses.
    this.head.rotation.y = Math.sin(this.animTime * 0.6 + this.idlePhase) * 0.5;

    if (this.pose === 'sit') {
      // Legs folded forward over the bunk edge, arms resting on the thighs.
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, -1.35, 0.2);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -1.35, 0.2);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -0.25, 0.2);
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.25, 0.2);
      this.group.rotation.z = 0;
    } else {
      // Standing at the bars: relax the limbs, gentle weight sway.
      for (const limb of [this.leftLeg, this.rightLeg, this.leftArm, this.rightArm]) {
        limb.rotation.x *= 0.85;
      }
      this.group.rotation.z = Math.sin(this.animTime * 1.3 + this.idlePhase) * 0.02;
    }
  }
}
