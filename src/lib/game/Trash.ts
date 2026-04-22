import * as THREE from 'three';

const trashGeometries = [
  new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8),
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.CylinderGeometry(0.1, 0.15, 0.5, 6),
];

export class Trash {
  private readonly trash: THREE.Group;
  private readonly material: THREE.MeshPhongMaterial;
  private readonly velocity: THREE.Vector3;
  private readonly rotationSpeed: THREE.Vector3;
  private alive = true;
  private lifeTime = 10;
  private onGround = false;
  private timeOnGround = 0;
  private readonly RADIUS = 0.3;
  private readonly GROUND_TIME = 3;

  constructor(position: THREE.Vector3, direction: THREE.Vector3, throwSpeed: number = 12) {
    this.trash = new THREE.Group();
    this.trash.position.copy(position);

    this.velocity = direction.normalize().multiplyScalar(throwSpeed);
    this.velocity.y += 5;

    this.material = new THREE.MeshPhongMaterial({ color: 0x886644, shininess: 10 });
    const geometry = trashGeometries[Math.floor(Math.random() * trashGeometries.length)];
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = true;
    this.trash.add(mesh);

    this.rotationSpeed = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
    );
  }

  public checkCollision(position: THREE.Vector3, radius: number = 1.5): boolean {
    return this.trash.position.distanceTo(position) < this.RADIUS + radius;
  }

  public update(deltaTime: number, groundHeight: number): void {
    this.lifeTime -= deltaTime;
    if (this.lifeTime <= 0) this.alive = false;

    if (!this.onGround) {
      this.velocity.y -= 9.8 * deltaTime;
      this.trash.position.x += this.velocity.x * deltaTime;
      this.trash.position.y += this.velocity.y * deltaTime;
      this.trash.position.z += this.velocity.z * deltaTime;
      this.tumble(deltaTime);

      if (this.trash.position.y <= groundHeight + 0.2) {
        this.onGround = true;
        this.trash.position.y = groundHeight + 0.1;
        this.velocity.set(0, 0, 0);
        this.rotationSpeed.multiplyScalar(0.1);
      }
      return;
    }

    this.timeOnGround += deltaTime;
    this.tumble(deltaTime);
    this.rotationSpeed.multiplyScalar(0.95);

    const fadeStart = this.GROUND_TIME - 1;
    if (this.timeOnGround > fadeStart) {
      this.material.transparent = true;
      this.material.opacity = Math.max(0, this.GROUND_TIME - this.timeOnGround);
    }

    if (this.timeOnGround >= this.GROUND_TIME) this.alive = false;
  }

  private tumble(deltaTime: number) {
    this.trash.rotation.x += this.rotationSpeed.x * deltaTime;
    this.trash.rotation.y += this.rotationSpeed.y * deltaTime;
    this.trash.rotation.z += this.rotationSpeed.z * deltaTime;
  }

  public getTrash(): THREE.Group { return this.trash; }
  public isAlive(): boolean { return this.alive; }
  public getPosition(): THREE.Vector3 { return this.trash.position; }
  public destroy(): void { this.alive = false; }
}
