import * as THREE from 'three';
import { Trash } from './Trash';

export class Zombie {
  private zombie: THREE.Group;
  private position: THREE.Vector3;
  private speed: number = 5; // Zombies run at 5 units/s (slower)
  private readonly ZOMBIE_HEIGHT = 2;
  private readonly ZOMBIE_RADIUS = 0.8; // Larger radius for better spacing
  private destroyed: boolean = false;
  private animationTime: number = 0;
  private leftLeg: THREE.Mesh;
  private rightLeg: THREE.Mesh;
  private leftArm: THREE.Mesh;
  private rightArm: THREE.Mesh;
  private torso: THREE.Mesh;
  private thrownTrash: Trash[] = [];
  private throwCooldown: number = 0;
  private readonly THROW_COOLDOWN = 2; // Throw every 2 seconds
  private readonly THROW_RANGE = 20; // Throw when player is within 20 units

  constructor(startPosition: THREE.Vector3) {
    this.zombie = new THREE.Group();
    this.position = startPosition.clone();
    this.createZombie();
    this.zombie.position.copy(this.position);

    // Initialize body parts for animation
    this.leftLeg = this.zombie.children[0].children[0] as THREE.Mesh;
    this.rightLeg = this.zombie.children[0].children[1] as THREE.Mesh;
    this.leftArm = this.zombie.children[0].children[3] as THREE.Mesh;
    this.rightArm = this.zombie.children[0].children[4] as THREE.Mesh;
    this.torso = this.zombie.children[0].children[2] as THREE.Mesh;
  }

  private createZombie() {
    const bodyGroup = new THREE.Group();

    // Zombie skin material (greenish-gray)
    const zombieSkinMaterial = new THREE.MeshPhongMaterial({
      color: 0x8b9b7a,  // Pale green-gray
      shininess: 10
    });

    // Clothing material (tattered)
    const clothingMaterial = new THREE.MeshPhongMaterial({
      color: 0x4a4a4a,  // Dark gray
      shininess: 5
    });

    // Legs
    const legGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8);

    const leftLeg = new THREE.Mesh(legGeometry, clothingMaterial);
    leftLeg.position.set(-0.2, 0.4, 0);
    leftLeg.castShadow = true;
    bodyGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, clothingMaterial);
    rightLeg.position.set(0.2, 0.4, 0);
    rightLeg.castShadow = true;
    bodyGroup.add(rightLeg);

    // Torso
    const torsoGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.3);
    const torso = new THREE.Mesh(torsoGeometry, clothingMaterial);
    torso.position.set(0, 1.2, 0);
    torso.castShadow = true;
    bodyGroup.add(torso);

    // Arms
    const armGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8);

    const leftArm = new THREE.Mesh(armGeometry, zombieSkinMaterial);
    leftArm.position.set(-0.4, 1.2, 0);
    leftArm.rotation.z = Math.PI * 0.3; // Arms reaching forward
    leftArm.rotation.x = Math.PI * 0.2;
    leftArm.castShadow = true;
    bodyGroup.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, zombieSkinMaterial);
    rightArm.position.set(0.4, 1.2, 0);
    rightArm.rotation.z = -Math.PI * 0.3; // Arms reaching forward
    rightArm.rotation.x = Math.PI * 0.2;
    rightArm.castShadow = true;
    bodyGroup.add(rightArm);

    // Head
    const headGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const head = new THREE.Mesh(headGeometry, zombieSkinMaterial);
    head.position.set(0, 1.8, 0);
    head.castShadow = true;
    bodyGroup.add(head);

    // Eyes (glowing red)
    const eyeGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.1, 1.85, 0.2);
    bodyGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.1, 1.85, 0.2);
    bodyGroup.add(rightEye);

    // Mouth (dark)
    const mouthGeometry = new THREE.BoxGeometry(0.2, 0.05, 0.05);
    const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
    mouth.position.set(0, 1.7, 0.2);
    bodyGroup.add(mouth);

    this.zombie.add(bodyGroup);
  }

  public getZombie(): THREE.Group {
    return this.zombie;
  }

  public getPosition(): THREE.Vector3 {
    return this.zombie.position;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public destroy(): void {
    this.destroyed = true;
  }

  public update(deltaTime: number, targetPosition: THREE.Vector3, otherZombies: Zombie[] = []) {
    if (this.destroyed) return;

    this.animationTime += deltaTime * 8; // Animation speed

    // Simple running animation
    const legSwing = Math.sin(this.animationTime) * 0.4;
    const armSwing = Math.sin(this.animationTime) * 0.3;

    this.leftLeg.rotation.x = legSwing;
    this.rightLeg.rotation.x = -legSwing;
    this.leftArm.rotation.x = -armSwing + Math.PI * 0.2;
    this.rightArm.rotation.x = armSwing + Math.PI * 0.2;

    // Add slight bobbing motion
    this.torso.position.y = 1.2 + Math.abs(Math.sin(this.animationTime)) * 0.1;

    // Calculate direction to target
    const direction = new THREE.Vector3().subVectors(targetPosition, this.zombie.position);
    direction.y = 0; // Keep zombies on the ground

    const distance = direction.length();

    // Update throw cooldown
    this.throwCooldown -= deltaTime;

    // Throw trash at player if in range and cooldown is ready
    if (distance < this.THROW_RANGE && distance > 3 && this.throwCooldown <= 0) {
      this.throwTrash(targetPosition);
      this.throwCooldown = this.THROW_COOLDOWN;
    }

    if (distance > 0.5) {
      // Normalize and move towards target
      direction.normalize();

      // Add separation force from other zombies
      const separationForce = new THREE.Vector3();
      for (const other of otherZombies) {
        if (other === this || other.isDestroyed()) continue;

        const otherPos = other.getPosition();
        const diff = new THREE.Vector3().subVectors(this.zombie.position, otherPos);
        diff.y = 0;
        const dist = diff.length();

        // If too close to another zombie, add repulsion force
        const minDistance = this.ZOMBIE_RADIUS * 3; // Keep distance
        if (dist < minDistance && dist > 0.1) {
          diff.normalize();
          const strength = (minDistance - dist) / minDistance;
          separationForce.add(diff.multiplyScalar(strength));
        }
      }

      // Combine chase direction with separation force
      if (separationForce.length() > 0) {
        separationForce.normalize().multiplyScalar(0.5); // Separation has 50% influence
        direction.multiplyScalar(0.5).add(separationForce).normalize();
      }

      // Move zombie
      const movement = direction.multiplyScalar(this.speed * deltaTime);
      this.zombie.position.add(movement);

      // Make zombie face the movement direction
      const angle = Math.atan2(direction.x, direction.z);
      this.zombie.rotation.y = angle;
    }
  }

  public checkCollision(position: THREE.Vector3, radius: number = 2): boolean {
    const distance = this.zombie.position.distanceTo(position);
    return distance < (this.ZOMBIE_RADIUS + radius);
  }

  public getRadius(): number {
    return this.ZOMBIE_RADIUS;
  }

  private throwTrash(targetPosition: THREE.Vector3): void {
    // Calculate throw position (from zombie's hand height)
    const throwPosition = this.zombie.position.clone();
    throwPosition.y += 1.5; // Hand height

    // Calculate direction to target
    const direction = new THREE.Vector3().subVectors(targetPosition, throwPosition);
    direction.y = 0; // Throw horizontally, let physics handle the arc

    // Create and add trash
    const trash = new Trash(throwPosition, direction, 12);
    this.thrownTrash.push(trash);
  }

  public getThrownTrash(): Trash[] {
    return this.thrownTrash;
  }

  public cleanupTrash(): void {
    // Remove dead trash from the array
    this.thrownTrash = this.thrownTrash.filter(trash => trash.isAlive());
  }
}
