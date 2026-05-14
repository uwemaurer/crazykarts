import * as THREE from 'three';

// All player-physics constants below are expressed in metric units (m, m/s,
// m/s²). They run through `mToV` to convert into the voxel-space coordinates
// the collision/integration code uses, where 1 voxel = METERS_PER_VOXEL m.
// Change METERS_PER_VOXEL to keep the metric values intact while rescaling
// the world — must match Game.WORLD_SCALE.
// Temporarily reverted to 1 to bisect the LOD-fade artifact (see comment
// in Game.ts WORLD_SCALE). Restore to 0.5 to re-enable half-metre blocks.
const METERS_PER_VOXEL = 1.0;
const mToV = (meters: number): number => meters / METERS_PER_VOXEL;

const EYE_HEIGHT = mToV(1.6);       // human eye height
const BODY_HEIGHT = mToV(1.8);      // standing height
const BODY_RADIUS = mToV(0.32);     // shoulder half-width
const WALK_SPEED = mToV(5);         // 5 m/s — brisk walk
const SPRINT_SPEED = mToV(8);       // 8 m/s — slow jog
const JUMP_SPEED = mToV(9);         // initial vertical velocity → ~1.7 m peak
const GRAVITY = mToV(24);           // game-tuned, snappier than real 9.81 m/s²
const MAX_FALL_SPEED = mToV(40);    // terminal velocity cap
const STEP_UP_HEIGHT = mToV(1.05);  // auto-step a 1 m ledge with margin
// Fly-mode movement. Faster than walking so you can survey terrain quickly,
// noclip through everything, no gravity. Vertical via Space (up) / Q (down).
const FLY_SPEED = mToV(15);
const FLY_SPRINT_SPEED = mToV(35);

export interface PlayerInput {
  forward: number; // -1..1
  strafe: number;  // -1..1
  jump: boolean;
  sprint: boolean;
  descend?: boolean; // fly-mode only — pushes the camera down
}

export type IsSolid = (wx: number, wy: number, wz: number) => boolean;

export class Player {
  public readonly position: THREE.Vector3;
  public readonly velocity = new THREE.Vector3();
  public yaw = 0;
  public pitch = 0;
  public grounded = false;
  public didJump = false;
  public flyMode = false;
  public readonly eye = new THREE.Vector3();
  public readonly forward = new THREE.Vector3();

  private readonly lookLimit = Math.PI / 2 - 0.01;

  constructor(spawn: THREE.Vector3) {
    this.position = spawn.clone();
    this.updateDerived();
  }

  public addLook(dxPixels: number, dyPixels: number, sensitivity = 0.0022): void {
    this.yaw -= dxPixels * sensitivity;
    this.pitch -= dyPixels * sensitivity;
    if (this.pitch > this.lookLimit) this.pitch = this.lookLimit;
    if (this.pitch < -this.lookLimit) this.pitch = -this.lookLimit;
  }

  public update(deltaTime: number, input: PlayerInput, isSolid: IsSolid): void {
    if (this.flyMode) {
      this.updateFly(deltaTime, input);
      return;
    }

    const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;

    // Horizontal wish vector in world space from yaw.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wishX = fx * input.forward + rx * input.strafe;
    let wishZ = fz * input.forward + rz * input.strafe;
    const mag = Math.hypot(wishX, wishZ);
    if (mag > 1) { wishX /= mag; wishZ /= mag; }

    this.velocity.x = wishX * speed;
    this.velocity.z = wishZ * speed;

    // Gravity + jump
    this.didJump = false;
    this.velocity.y -= GRAVITY * deltaTime;
    if (this.velocity.y < -MAX_FALL_SPEED) this.velocity.y = -MAX_FALL_SPEED;
    if (input.jump && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      this.didJump = true;
    }

    // Sweep per-axis to resolve collisions with solid voxels.
    this.sweepAxis(0, this.velocity.x * deltaTime, isSolid);
    this.sweepAxis(2, this.velocity.z * deltaTime, isSolid);
    this.grounded = false;
    this.sweepAxis(1, this.velocity.y * deltaTime, isSolid);

    this.updateDerived();
  }

  // No gravity, no collision. Horizontal movement uses yaw only (ignores
  // pitch), so looking slightly down while flying forward keeps your
  // altitude. Vertical movement comes purely from Space (up) / Q (down).
  private updateFly(deltaTime: number, input: PlayerInput): void {
    const speed = input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wishX = fx * input.forward + rx * input.strafe;
    let wishZ = fz * input.forward + rz * input.strafe;
    let wishY = 0;
    if (input.jump) wishY += 1;
    if (input.descend) wishY -= 1;
    const mag = Math.hypot(wishX, wishY, wishZ);
    if (mag > 1) { wishX /= mag; wishY /= mag; wishZ /= mag; }

    this.velocity.set(wishX * speed, wishY * speed, wishZ * speed);
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;
    this.position.z += this.velocity.z * deltaTime;
    this.grounded = false;
    this.didJump = false;
    this.updateDerived();
  }

  private sweepAxis(axis: 0 | 1 | 2, delta: number, isSolid: IsSolid): void {
    if (delta === 0) return;
    const axisKey = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    const old = this.position[axisKey];
    this.position[axisKey] = old + delta;
    if (!this.intersectsSolid(isSolid)) return;

    // Blocked. For horizontal movement while grounded, try auto step-up:
    // lift the player by STEP_UP_HEIGHT; if the new position is clear, keep it
    // (gravity will settle the player onto the block next frame).
    if ((axis === 0 || axis === 2) && this.grounded) {
      const oldY = this.position.y;
      this.position.y = oldY + STEP_UP_HEIGHT;
      if (!this.intersectsSolid(isSolid)) {
        // Hop succeeded. Keep the player grounded so consecutive steps chain
        // (e.g., walking up a staircase of placed blocks).
        this.grounded = true;
        this.velocity.y = Math.max(this.velocity.y, 0);
        return;
      }
      this.position.y = oldY;
    }

    // Still blocked — revert and zero velocity on this axis.
    this.position[axisKey] = old;
    if (axis === 1) {
      if (delta < 0) this.grounded = true;
      this.velocity.y = 0;
    } else if (axis === 0) {
      this.velocity.x = 0;
    } else {
      this.velocity.z = 0;
    }
  }

  private intersectsSolid(isSolid: IsSolid): boolean {
    const minX = this.position.x - BODY_RADIUS;
    const maxX = this.position.x + BODY_RADIUS;
    const minY = this.position.y;
    const maxY = this.position.y + BODY_HEIGHT;
    const minZ = this.position.z - BODY_RADIUS;
    const maxZ = this.position.z + BODY_RADIUS;

    const x0 = Math.floor(minX);
    const x1 = Math.floor(maxX - 1e-6);
    const y0 = Math.floor(minY);
    const y1 = Math.floor(maxY - 1e-6);
    const z0 = Math.floor(minZ);
    const z1 = Math.floor(maxZ - 1e-6);

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  public applyToCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.eye);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
    camera.rotation.z = 0;
  }

  public getEyeHeight(): number {
    return EYE_HEIGHT;
  }

  public getBodyHeight(): number {
    return BODY_HEIGHT;
  }

  public getBodyRadius(): number {
    return BODY_RADIUS;
  }

  private updateDerived(): void {
    this.eye.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
}
