import * as THREE from 'three';

const scratchDir = new THREE.Vector3();
const scratchSep = new THREE.Vector3();
const scratchDiff = new THREE.Vector3();

export abstract class ZombieBase {
  public readonly zombie: THREE.Group;
  protected destroyed = false;
  protected animationTime = 0;
  protected leftLeg!: THREE.Mesh;
  protected rightLeg!: THREE.Mesh;
  protected leftArm!: THREE.Mesh;
  protected rightArm!: THREE.Mesh;
  protected torso!: THREE.Mesh;
  protected abstract readonly speed: number;
  protected abstract readonly radius: number;

  constructor(startPosition: THREE.Vector3) {
    this.zombie = new THREE.Group();
    this.zombie.position.copy(startPosition);
  }

  public getZombie(): THREE.Group { return this.zombie; }
  public getPosition(): THREE.Vector3 { return this.zombie.position; }
  public isDestroyed(): boolean { return this.destroyed; }
  public destroy(): void { this.destroyed = true; }
  public getRadius(): number { return this.radius; }

  public checkCollision(position: THREE.Vector3, radius: number = 2): boolean {
    return this.zombie.position.distanceTo(position) < this.radius + radius;
  }

  protected chase(
    target: THREE.Vector3,
    others: ZombieBase[],
    deltaTime: number,
    minDistance: number = 0.5,
  ): number {
    const direction = scratchDir.subVectors(target, this.zombie.position);
    direction.y = 0;
    const distance = direction.length();

    if (distance <= minDistance) return distance;

    direction.normalize();

    const separation = scratchSep.set(0, 0, 0);
    const separationRadius = this.radius * 3;
    for (const other of others) {
      if (other === this || other.destroyed) continue;
      const diff = scratchDiff.subVectors(this.zombie.position, other.zombie.position);
      diff.y = 0;
      const dist = diff.length();
      if (dist < separationRadius && dist > 0.1) {
        separation.add(diff.normalize().multiplyScalar((separationRadius - dist) / separationRadius));
      }
    }

    if (separation.lengthSq() > 0) {
      separation.normalize().multiplyScalar(0.5);
      direction.multiplyScalar(0.5).add(separation).normalize();
    }

    this.zombie.position.add(direction.multiplyScalar(this.speed * deltaTime));
    this.zombie.rotation.y = Math.atan2(direction.x, direction.z);
    return distance;
  }
}
