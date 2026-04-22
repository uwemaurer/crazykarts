import * as THREE from 'three';
import { ZombieBase } from './ZombieBase';

export class MegaZombie extends ZombieBase {
  protected readonly speed = 3;
  protected readonly radius = 2;
  private clubGroup: THREE.Group;
  private attackCooldown = 0;
  private isAttacking = false;
  private attackTime = 0;
  private hasHitThisAttack = false;
  private readonly ATTACK_COOLDOWN = 1.5;
  private readonly ATTACK_RANGE = 4;

  constructor(startPosition: THREE.Vector3) {
    super(startPosition);
    this.clubGroup = new THREE.Group();
    this.createBody();
  }

  private createBody() {
    const bodyGroup = new THREE.Group();

    const skin = new THREE.MeshPhongMaterial({ color: 0x5a6b4a, shininess: 10 });
    const clothing = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 5 });
    const wood = new THREE.MeshPhongMaterial({ color: 0x654321, shininess: 5 });

    const legGeom = new THREE.CylinderGeometry(0.35, 0.35, 2, 8);
    this.leftLeg = new THREE.Mesh(legGeom, clothing);
    this.leftLeg.position.set(-0.5, 1, 0);
    this.leftLeg.castShadow = true;
    bodyGroup.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeom, clothing);
    this.rightLeg.position.set(0.5, 1, 0);
    this.rightLeg.castShadow = true;
    bodyGroup.add(this.rightLeg);

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 0.8), clothing);
    this.torso.position.set(0, 3, 0);
    this.torso.castShadow = true;
    bodyGroup.add(this.torso);

    const armGeom = new THREE.CylinderGeometry(0.25, 0.25, 1.5, 8);
    this.leftArm = new THREE.Mesh(armGeom, skin);
    this.leftArm.position.set(-1, 3, 0);
    this.leftArm.rotation.z = Math.PI * 0.2;
    this.leftArm.castShadow = true;
    bodyGroup.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeom, skin);
    this.rightArm.position.set(1, 3, 0);
    this.rightArm.castShadow = true;
    bodyGroup.add(this.rightArm);

    const clubHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8), wood);
    clubHandle.position.set(0, -1.5, 0);
    clubHandle.castShadow = true;
    this.clubGroup.add(clubHandle);

    const clubHead = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), wood);
    clubHead.position.set(0, -2.7, 0);
    clubHead.castShadow = true;
    this.clubGroup.add(clubHead);

    this.clubGroup.position.set(0, -0.75, 0);
    this.rightArm.add(this.clubGroup);

    const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skin);
    head.position.set(0, 4.5, 0);
    head.castShadow = true;
    bodyGroup.add(head);

    const eyeGeom = new THREE.SphereGeometry(0.1, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(-0.3, 4.6, 0.5);
    bodyGroup.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0.3, 4.6, 0.5);
    bodyGroup.add(rightEye);

    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    mouth.position.set(0, 4.2, 0.5);
    bodyGroup.add(mouth);

    this.zombie.add(bodyGroup);
  }

  public update(deltaTime: number, targetPosition: THREE.Vector3, otherZombies: ZombieBase[] = []) {
    if (this.destroyed) return;

    this.animationTime += deltaTime * 4;

    const dx = targetPosition.x - this.zombie.position.x;
    const dz = targetPosition.z - this.zombie.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    this.attackCooldown -= deltaTime;
    if (distance < this.ATTACK_RANGE && this.attackCooldown <= 0 && !this.isAttacking) {
      this.isAttacking = true;
      this.attackTime = 0;
      this.attackCooldown = this.ATTACK_COOLDOWN;
      this.hasHitThisAttack = false;
    }

    if (this.isAttacking) {
      this.updateAttackAnimation(deltaTime);
      return;
    }

    this.updateWalkAnimation();
    if (distance > 1) {
      this.chase(targetPosition, otherZombies, deltaTime, 1);
    }
  }

  private updateAttackAnimation(deltaTime: number) {
    this.attackTime += deltaTime * 5;

    if (this.attackTime >= 1) {
      this.rightArm.rotation.x = -Math.PI * 0.4;
      this.rightArm.rotation.z = Math.PI * 0.3;
      this.isAttacking = false;
      return;
    }

    if (this.attackTime < 0.2) {
      const p = this.attackTime / 0.2;
      this.rightArm.rotation.x = -Math.PI * 0.4 - Math.PI * 0.2 * p;
      this.rightArm.rotation.z = Math.PI * 0.3 + Math.PI * 0.2 * p;
      return;
    }

    if (this.attackTime < 0.6) {
      const p = (this.attackTime - 0.2) / 0.4;
      this.rightArm.rotation.x = -Math.PI * 0.6 + p * Math.PI * 1.4;
      this.rightArm.rotation.z = Math.PI * 0.5 - p * Math.PI * 0.7;
      return;
    }

    const p = (this.attackTime - 0.6) / 0.4;
    const targetX = -Math.PI * 0.4;
    const targetZ = Math.PI * 0.3;
    this.rightArm.rotation.x = Math.PI * 0.8 - (Math.PI * 0.8 - targetX) * p;
    this.rightArm.rotation.z = -Math.PI * 0.2 + (targetZ + Math.PI * 0.2) * p;
  }

  private updateWalkAnimation() {
    const legSwing = Math.sin(this.animationTime) * 0.3;
    const armSwing = Math.sin(this.animationTime) * 0.15;
    const sway = Math.sin(this.animationTime * 0.5) * 0.1;

    this.leftLeg.rotation.x = legSwing;
    this.rightLeg.rotation.x = -legSwing;
    this.leftArm.rotation.x = -armSwing;
    this.rightArm.rotation.x = -Math.PI * 0.4 + sway;
    this.rightArm.rotation.z = Math.PI * 0.3;
    this.torso.position.y = 3 + Math.abs(Math.sin(this.animationTime)) * 0.2;
  }

  public isAttackingPlayer(): boolean {
    return this.isAttacking && this.attackTime > 0.25 && this.attackTime < 0.5 && !this.hasHitThisAttack;
  }

  public markAttackHit(): void {
    this.hasHitThisAttack = true;
  }

  public getAttackRange(): number {
    return this.ATTACK_RANGE;
  }
}
