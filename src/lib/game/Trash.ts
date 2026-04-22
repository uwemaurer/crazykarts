import * as THREE from 'three';

export class Trash {
  private trash: THREE.Group;
  private velocity: THREE.Vector3;
  private alive: boolean = true;
  private boundingSphere: THREE.Sphere;
  private lifeTime: number;
  private rotationSpeed: THREE.Vector3;
  private onGround: boolean = false;
  private timeOnGround: number = 0;
  private readonly GROUND_TIME = 3; // Stay on ground for 3 seconds

  constructor(position: THREE.Vector3, direction: THREE.Vector3, throwSpeed: number = 12) {
    this.trash = new THREE.Group();

    // Calculate throwing velocity with arc
    this.velocity = direction.normalize().multiplyScalar(throwSpeed);
    this.velocity.y += 5; // Add upward velocity for arc

    this.createTrash();
    this.trash.position.copy(position);

    // Create bounding sphere for collision detection
    this.boundingSphere = new THREE.Sphere(this.trash.position, 0.3);
    this.lifeTime = 10; // 10 seconds total lifetime (in case it never hits ground)

    // Random rotation for tumbling effect
    this.rotationSpeed = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );
  }

  private createTrash() {
    // Create a random trash item (can, bottle, box, etc.)
    const trashType = Math.floor(Math.random() * 3);

    let mesh: THREE.Mesh;
    const trashMaterial = new THREE.MeshPhongMaterial({
      color: 0x886644, // Brown/rusty color
      shininess: 10
    });

    if (trashType === 0) {
      // Soda can
      const geometry = new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8);
      mesh = new THREE.Mesh(geometry, trashMaterial);
    } else if (trashType === 1) {
      // Box
      const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
      mesh = new THREE.Mesh(geometry, trashMaterial);
    } else {
      // Bottle
      const geometry = new THREE.CylinderGeometry(0.1, 0.15, 0.5, 6);
      mesh = new THREE.Mesh(geometry, trashMaterial);
    }

    mesh.castShadow = true;
    this.trash.add(mesh);
  }

  checkCollision(position: THREE.Vector3, radius: number = 1.5): boolean {
    // Update bounding sphere position
    this.boundingSphere.center.copy(this.trash.position);

    const distance = this.trash.position.distanceTo(position);
    return distance < (this.boundingSphere.radius + radius);
  }

  update(deltaTime: number = 1/60, groundHeight: number = 0): void {
    // Update lifetime
    this.lifeTime -= deltaTime;

    if (!this.onGround) {
      // Apply gravity
      this.velocity.y -= 9.8 * deltaTime;

      // Update position based on velocity
      this.trash.position.add(this.velocity.clone().multiplyScalar(deltaTime));

      // Tumble the trash while in air
      this.trash.rotation.x += this.rotationSpeed.x * deltaTime;
      this.trash.rotation.y += this.rotationSpeed.y * deltaTime;
      this.trash.rotation.z += this.rotationSpeed.z * deltaTime;

      // Check if hit the ground
      if (this.trash.position.y <= groundHeight + 0.2) {
        this.onGround = true;
        this.trash.position.y = groundHeight + 0.1; // Settle on ground
        this.velocity.set(0, 0, 0); // Stop moving
        this.rotationSpeed.multiplyScalar(0.1); // Slow down rotation significantly
      }
    } else {
      // On ground - count time and slowly stop rotating
      this.timeOnGround += deltaTime;

      // Slow rotation decay
      this.trash.rotation.x += this.rotationSpeed.x * deltaTime;
      this.trash.rotation.y += this.rotationSpeed.y * deltaTime;
      this.trash.rotation.z += this.rotationSpeed.z * deltaTime;
      this.rotationSpeed.multiplyScalar(0.95); // Gradually stop rotating

      // Fade out in the last second
      if (this.timeOnGround > this.GROUND_TIME - 1) {
        const fadeProgress = this.timeOnGround - (this.GROUND_TIME - 1);
        const mesh = this.trash.children[0] as THREE.Mesh;
        if (mesh && mesh.material) {
          const material = mesh.material as THREE.MeshPhongMaterial;
          material.transparent = true;
          material.opacity = 1 - fadeProgress;
        }
      }

      // Check if should disappear
      if (this.timeOnGround >= this.GROUND_TIME) {
        this.alive = false;
      }
    }

    // Check if lifetime expired (safety check)
    if (this.lifeTime <= 0) {
      this.alive = false;
    }
  }

  getTrash(): THREE.Group {
    return this.trash;
  }

  isAlive(): boolean {
    return this.alive;
  }

  getPosition(): THREE.Vector3 {
    return this.trash.position;
  }

  destroy() {
    this.alive = false;
  }
}
