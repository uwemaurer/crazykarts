import * as THREE from 'three';
import { ZombieBase } from './ZombieBase';
import { Trash } from './Trash';

export class Zombie extends ZombieBase {
  protected readonly speed = 5;
  protected readonly radius = 0.8;
  private thrownTrash: Trash[] = [];
  private throwCooldown = 0;
  private readonly THROW_COOLDOWN = 2;
  private readonly THROW_RANGE = 20;

  constructor(startPosition: THREE.Vector3) {
    super(startPosition);
    this.createBody();
  }

  private createBody() {
    const bodyGroup = new THREE.Group();

    const skin = new THREE.MeshPhongMaterial({ color: 0x8b9b7a, shininess: 10 });
    const clothing = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, shininess: 5 });

    const legGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8);
    this.leftLeg = new THREE.Mesh(legGeom, clothing);
    this.leftLeg.position.set(-0.2, 0.4, 0);
    this.leftLeg.castShadow = true;
    bodyGroup.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeom, clothing);
    this.rightLeg.position.set(0.2, 0.4, 0);
    this.rightLeg.castShadow = true;
    bodyGroup.add(this.rightLeg);

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), clothing);
    this.torso.position.set(0, 1.2, 0);
    this.torso.castShadow = true;
    bodyGroup.add(this.torso);

    const armGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8);
    this.leftArm = new THREE.Mesh(armGeom, skin);
    this.leftArm.position.set(-0.4, 1.2, 0);
    this.leftArm.rotation.z = Math.PI * 0.3;
    this.leftArm.rotation.x = Math.PI * 0.2;
    this.leftArm.castShadow = true;
    bodyGroup.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeom, skin);
    this.rightArm.position.set(0.4, 1.2, 0);
    this.rightArm.rotation.z = -Math.PI * 0.3;
    this.rightArm.rotation.x = Math.PI * 0.2;
    this.rightArm.castShadow = true;
    bodyGroup.add(this.rightArm);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skin);
    head.position.set(0, 1.8, 0);
    head.castShadow = true;
    bodyGroup.add(head);

    const eyeGeom = new THREE.SphereGeometry(0.05, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(-0.1, 1.85, 0.2);
    bodyGroup.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0.1, 1.85, 0.2);
    bodyGroup.add(rightEye);

    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    mouth.position.set(0, 1.7, 0.2);
    bodyGroup.add(mouth);

    this.zombie.add(bodyGroup);
  }

  public update(deltaTime: number, targetPosition: THREE.Vector3, otherZombies: ZombieBase[] = []) {
    if (this.destroyed) return;

    this.animationTime += deltaTime * 8;
    const legSwing = Math.sin(this.animationTime) * 0.4;
    const armSwing = Math.sin(this.animationTime) * 0.3;
    this.leftLeg.rotation.x = legSwing;
    this.rightLeg.rotation.x = -legSwing;
    this.leftArm.rotation.x = -armSwing + Math.PI * 0.2;
    this.rightArm.rotation.x = armSwing + Math.PI * 0.2;
    this.torso.position.y = 1.2 + Math.abs(Math.sin(this.animationTime)) * 0.1;

    const distance = this.chase(targetPosition, otherZombies, deltaTime);

    this.throwCooldown -= deltaTime;
    if (distance < this.THROW_RANGE && distance > 3 && this.throwCooldown <= 0) {
      this.throwTrash(targetPosition);
      this.throwCooldown = this.THROW_COOLDOWN;
    }
  }

  private throwTrash(targetPosition: THREE.Vector3): void {
    const throwPosition = this.zombie.position.clone();
    throwPosition.y += 1.5;
    const direction = new THREE.Vector3().subVectors(targetPosition, throwPosition);
    direction.y = 0;
    this.thrownTrash.push(new Trash(throwPosition, direction, 12));
  }

  public getThrownTrash(): Trash[] {
    return this.thrownTrash;
  }
}
