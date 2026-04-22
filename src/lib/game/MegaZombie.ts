import * as THREE from 'three';

export class MegaZombie {
  private zombie: THREE.Group;
  private position: THREE.Vector3;
  private speed: number = 3; // Slower than regular zombies
  private readonly ZOMBIE_HEIGHT = 5;
  private readonly ZOMBIE_RADIUS = 2; // Much larger radius
  private destroyed: boolean = false;
  private animationTime: number = 0;
  private leftLeg: THREE.Mesh;
  private rightLeg: THREE.Mesh;
  private leftArm: THREE.Mesh;
  private rightArm: THREE.Mesh;
  private clubGroup: THREE.Group;
  private torso: THREE.Mesh;
  private attackCooldown: number = 0;
  private readonly ATTACK_COOLDOWN = 1.5; // Attack every 1.5 seconds
  private readonly ATTACK_RANGE = 4; // Attack when player is within 4 units
  private isAttacking: boolean = false;
  private attackTime: number = 0;
  private hasHitThisAttack: boolean = false; // Track if this attack already landed

  constructor(startPosition: THREE.Vector3) {
    this.zombie = new THREE.Group();
    this.position = startPosition.clone();

    // Create club group first (will be attached later)
    this.clubGroup = new THREE.Group();

    this.createZombie();
    this.zombie.position.copy(this.position);

    // Initialize body parts for animation
    this.leftLeg = this.zombie.children[0].children[0] as THREE.Mesh;
    this.rightLeg = this.zombie.children[0].children[1] as THREE.Mesh;
    this.torso = this.zombie.children[0].children[2] as THREE.Mesh;
    this.leftArm = this.zombie.children[0].children[3] as THREE.Mesh;
    this.rightArm = this.zombie.children[0].children[4] as THREE.Mesh;
  }

  private createZombie() {
    const bodyGroup = new THREE.Group();

    // Mega zombie skin material (darker green)
    const zombieSkinMaterial = new THREE.MeshPhongMaterial({
      color: 0x5a6b4a,  // Darker green-gray
      shininess: 10
    });

    // Clothing material (darker and more worn)
    const clothingMaterial = new THREE.MeshPhongMaterial({
      color: 0x2a2a2a,  // Very dark gray
      shininess: 5
    });

    // Legs (thicker and longer)
    const legGeometry = new THREE.CylinderGeometry(0.35, 0.35, 2, 8);

    const leftLeg = new THREE.Mesh(legGeometry, clothingMaterial);
    leftLeg.position.set(-0.5, 1, 0);
    leftLeg.castShadow = true;
    bodyGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, clothingMaterial);
    rightLeg.position.set(0.5, 1, 0);
    rightLeg.castShadow = true;
    bodyGroup.add(rightLeg);

    // Torso (much bigger)
    const torsoGeometry = new THREE.BoxGeometry(1.5, 2, 0.8);
    const torso = new THREE.Mesh(torsoGeometry, clothingMaterial);
    torso.position.set(0, 3, 0);
    torso.castShadow = true;
    bodyGroup.add(torso);

    // Arms (thicker)
    const armGeometry = new THREE.CylinderGeometry(0.25, 0.25, 1.5, 8);

    const leftArm = new THREE.Mesh(armGeometry, zombieSkinMaterial);
    leftArm.position.set(-1, 3, 0);
    leftArm.rotation.z = Math.PI * 0.2;
    leftArm.castShadow = true;
    bodyGroup.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, zombieSkinMaterial);
    rightArm.position.set(1, 3, 0);
    rightArm.castShadow = true;
    bodyGroup.add(rightArm);

    // Club (big wooden club attached to right hand)
    const clubMaterial = new THREE.MeshPhongMaterial({
      color: 0x654321,  // Brown wood
      shininess: 5
    });

    // Club handle
    const clubHandle = new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8);
    const clubHandleMesh = new THREE.Mesh(clubHandle, clubMaterial);
    clubHandleMesh.position.set(0, -1.5, 0); // Position relative to hand
    clubHandleMesh.castShadow = true;
    this.clubGroup.add(clubHandleMesh);

    // Club head (bigger end at the bottom)
    const clubHeadGeometry = new THREE.SphereGeometry(0.4, 8, 8);
    const clubHead = new THREE.Mesh(clubHeadGeometry, clubMaterial);
    clubHead.position.set(0, -2.7, 0); // At the end of the club handle
    clubHead.castShadow = true;
    this.clubGroup.add(clubHead);

    // Position club group at the hand (bottom of right arm)
    this.clubGroup.position.set(0, -0.75, 0); // At the bottom of the arm
    rightArm.add(this.clubGroup);

    // Head (bigger)
    const headGeometry = new THREE.BoxGeometry(1, 1, 1);
    const head = new THREE.Mesh(headGeometry, zombieSkinMaterial);
    head.position.set(0, 4.5, 0);
    head.castShadow = true;
    bodyGroup.add(head);

    // Eyes (glowing red, larger)
    const eyeGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, emissive: 0xff0000 });

    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.3, 4.6, 0.5);
    bodyGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.3, 4.6, 0.5);
    bodyGroup.add(rightEye);

    // Mouth (dark, larger)
    const mouthGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.1);
    const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
    mouth.position.set(0, 4.2, 0.5);
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

  public update(deltaTime: number, targetPosition: THREE.Vector3, otherZombies: any[] = []) {
    if (this.destroyed) return;

    this.animationTime += deltaTime * 4; // Slower animation for mega zombie

    // Calculate direction to target
    const direction = new THREE.Vector3().subVectors(targetPosition, this.zombie.position);
    direction.y = 0;

    const distance = direction.length();

    // Update attack cooldown
    this.attackCooldown -= deltaTime;

    // Check if should attack
    if (distance < this.ATTACK_RANGE && this.attackCooldown <= 0 && !this.isAttacking) {
      this.isAttacking = true;
      this.attackTime = 0;
      this.attackCooldown = this.ATTACK_COOLDOWN;
      this.hasHitThisAttack = false; // Reset hit flag for new attack
    }

    // Handle attack animation
    if (this.isAttacking) {
      this.attackTime += deltaTime * 5; // Attack animation speed (faster for more responsive feel)

      // Swing club down by rotating the arm
      if (this.attackTime < 1) {
        // Wind up (0 to 0.2) - pull back even further from ready position
        if (this.attackTime < 0.2) {
          const windupProgress = this.attackTime / 0.2;
          this.rightArm.rotation.x = -Math.PI * 0.4 - (Math.PI * 0.2 * windupProgress); // Pull back further
          this.rightArm.rotation.z = Math.PI * 0.3 + (Math.PI * 0.2 * windupProgress); // Raise higher
        }
        // Swing down (0.2 to 0.6) - powerful downward strike
        else if (this.attackTime < 0.6) {
          const swingProgress = (this.attackTime - 0.2) / 0.4;
          const swingAngle = swingProgress * Math.PI * 1.4;
          this.rightArm.rotation.x = -Math.PI * 0.6 + swingAngle; // Powerful swing down
          this.rightArm.rotation.z = Math.PI * 0.5 - swingProgress * Math.PI * 0.7; // Swing across body
        }
        // Recovery (0.6 to 1.0) - return to ready position
        else {
          const recoveryProgress = (this.attackTime - 0.6) / 0.4;
          const targetX = -Math.PI * 0.4; // Back to ready position
          const targetZ = Math.PI * 0.3;
          this.rightArm.rotation.x = Math.PI * 0.8 - (Math.PI * 0.8 - targetX) * recoveryProgress;
          this.rightArm.rotation.z = -Math.PI * 0.2 + (targetZ + Math.PI * 0.2) * recoveryProgress;
        }
      } else {
        // Return to ready position (not down)
        this.rightArm.rotation.x = -Math.PI * 0.4;
        this.rightArm.rotation.z = Math.PI * 0.3;
        this.isAttacking = false;
      }
    } else {
      // Normal walking animation - hold club in ready-to-strike position
      const legSwing = Math.sin(this.animationTime) * 0.3;
      const armSwing = Math.sin(this.animationTime) * 0.15;

      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;
      this.leftArm.rotation.x = -armSwing;

      // Hold right arm up in threatening position, ready to strike
      this.rightArm.rotation.x = -Math.PI * 0.4; // Arm raised back
      this.rightArm.rotation.z = Math.PI * 0.3; // Arm held up and out

      // Slight menacing sway while walking
      const sway = Math.sin(this.animationTime * 0.5) * 0.1;
      this.rightArm.rotation.x += sway;

      // Add slight bobbing motion
      this.torso.position.y = 3 + Math.abs(Math.sin(this.animationTime)) * 0.2;
    }

    if (distance > 1 && !this.isAttacking) {
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
        const minDistance = this.ZOMBIE_RADIUS * 3;
        if (dist < minDistance && dist > 0.1) {
          diff.normalize();
          const strength = (minDistance - dist) / minDistance;
          separationForce.add(diff.multiplyScalar(strength));
        }
      }

      // Combine chase direction with separation force
      if (separationForce.length() > 0) {
        separationForce.normalize().multiplyScalar(0.5);
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

  public isAttackingPlayer(): boolean {
    // Player gets hit during the downswing phase (when club is coming down)
    return this.isAttacking && this.attackTime > 0.25 && this.attackTime < 0.5 && !this.hasHitThisAttack;
  }

  public markAttackHit(): void {
    this.hasHitThisAttack = true;
  }

  public getAttackRange(): number {
    return this.ATTACK_RANGE;
  }
}
