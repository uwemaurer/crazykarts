import * as THREE from 'three';
import { Rocket } from './Rocket';
import { Explosion } from './Explosion';

export class Car {
  private car: THREE.Group;
  private speed: number;
  private turnSpeed: number;
  private steeringAngle: number = 0;
  private position: THREE.Vector3;
  private cannon: THREE.Group = new THREE.Group();
  private rockets: Rocket[] = [];
  private static readonly TRACK_WIDTH = 20;
  private static readonly TRACK_LENGTH = 60;
  private static readonly CAR_WIDTH = 2;
  private static readonly CAR_LENGTH = 4;
  private static readonly COLLISION_RADIUS = 2.5; // Radius for collision detection
  private explosion: Explosion | null = null;
  private isExploded: boolean = false;
  private respawnTimer: number = 0;
  private readonly respawnDelay: number = 1; // 1 second delay
  private startPosition: THREE.Vector3;
  private color: number;
  private lastPosition: THREE.Vector3;
  private stuckTime: number = 0;
  private readonly STUCK_THRESHOLD = 0.05; // More sensitive movement threshold
  private readonly STUCK_TIME = 0.3; // Detect stuck state faster
  private isReversing: boolean = false;
  private reverseTime: number = 0;
  private readonly REVERSE_DURATION = 1.5; // Longer reverse time
  private lastRotation: number = 0;
  private stuckRotation: number = 0;
  private targetSpeed: number = 0;
  private readonly ACCELERATION = 50; // Balanced acceleration (was 300)
  private readonly DECELERATION = 10; // Added deceleration rate
  private readonly MAX_SPEED = 40; // Keep max speed
  private readonly MAX_REVERSE_SPEED = -20; // Keep max reverse speed
  private readonly MAX_STEERING_ANGLE = Math.PI / 4; // 45 degrees max steering
  private readonly STEERING_SPEED = 10.0; // Very fast wheel turning for immediate response
  private readonly TURN_RESPONSE = 2.5; // Direct turning response
  private debris: THREE.Group | null;
  private destroyed: boolean;
  private frontWheels: THREE.Group;
  private rearWheels: THREE.Group;
  private wheelRotation: number = 0;
  private readonly WHEEL_ROTATION_SPEED = 2.0; // Rotations per unit of speed

  constructor(color: number = 0xff0000, startPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0)) {
    this.car = new THREE.Group();
    this.frontWheels = new THREE.Group();
    this.rearWheels = new THREE.Group();
    this.speed = 0;
    this.turnSpeed = 0;
    this.position = startPosition.clone();
    this.startPosition = startPosition.clone();
    this.lastPosition = startPosition.clone();
    this.color = color;
    this.createCar(color);
    this.explosion = null;
    this.debris = null;
    this.destroyed = false;
  }

  private createCar(color: number) {
    const bodyGroup = new THREE.Group();

    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.4 });
    const panelMaterial = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.55 });
    const rubberMaterial = new THREE.MeshPhongMaterial({ color: 0x0d0d0d, shininess: 5 });
    const seatMaterial = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 30 });
    const chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.9, roughness: 0.15 });
    const skinMaterial = new THREE.MeshPhongMaterial({ color: 0xffcc99, shininess: 30 });
    const clothingMaterial = new THREE.MeshPhongMaterial({ color: 0x2244aa, shininess: 20 });
    const helmetMaterial = new THREE.MeshPhongMaterial({ color: 0x101010, shininess: 80 });
    const visorMaterial = new THREE.MeshPhongMaterial({ color: 0x223366, shininess: 100, transparent: true, opacity: 0.75 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 2.4), frameMaterial);
    chassis.position.y = 0.65;
    chassis.castShadow = true;
    bodyGroup.add(chassis);

    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 1.0), panelMaterial);
    tank.position.set(0, 1.0, -0.3);
    tank.castShadow = true;
    bodyGroup.add(tank);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.7), seatMaterial);
    seat.position.set(0, 1.0, 0.5);
    seat.castShadow = true;
    bodyGroup.add(seat);

    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.4), panelMaterial);
    fairing.position.set(0, 0.95, -1.1);
    fairing.castShadow = true;
    bodyGroup.add(fairing);

    const headlight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffbb, emissive: 0xffffaa, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.3 }),
    );
    headlight.position.set(0, 0.95, -1.32);
    headlight.rotation.x = Math.PI / 2;
    bodyGroup.add(headlight);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8), frameMaterial);
    stem.position.set(0, 1.15, -0.95);
    stem.rotation.x = Math.PI * 0.1;
    bodyGroup.add(stem);

    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), chromeMaterial);
    handlebar.position.set(0, 1.3, -0.85);
    handlebar.rotation.z = Math.PI / 2;
    bodyGroup.add(handlebar);

    const gripGeom = new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8);
    for (const xSign of [-1, 1]) {
      const grip = new THREE.Mesh(gripGeom, rubberMaterial);
      grip.position.set(xSign * 0.55, 1.3, -0.85);
      grip.rotation.z = Math.PI / 2;
      bodyGroup.add(grip);
    }

    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.6), frameMaterial);
    rack.position.set(0, 1.05, 1.1);
    bodyGroup.add(rack);

    const footrestGeom = new THREE.BoxGeometry(0.15, 0.05, 0.5);
    for (const xSign of [-1, 1]) {
      const fr = new THREE.Mesh(footrestGeom, frameMaterial);
      fr.position.set(xSign * 0.7, 0.55, 0.35);
      bodyGroup.add(fr);
    }

    const fenderGeom = new THREE.TorusGeometry(0.58, 0.08, 4, 10, Math.PI);
    for (const z of [-1.0, 1.0]) {
      for (const xSign of [-1, 1]) {
        const fender = new THREE.Mesh(fenderGeom, panelMaterial);
        fender.position.set(xSign * 0.75, 0.5, z);
        fender.rotation.y = Math.PI / 2;
        fender.castShadow = true;
        bodyGroup.add(fender);
      }
    }

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), chromeMaterial);
    exhaust.position.set(0.55, 0.8, 0.3);
    exhaust.rotation.x = Math.PI / 2;
    bodyGroup.add(exhaust);
    const exhaustTip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 8), chromeMaterial);
    exhaustTip.position.set(0.55, 0.8, 0.9);
    exhaustTip.rotation.x = Math.PI / 2;
    bodyGroup.add(exhaustTip);

    const riderGroup = new THREE.Group();

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.3), clothingMaterial);
    torso.position.set(0, 1.55, 0.1);
    torso.rotation.x = Math.PI * 0.08;
    torso.castShadow = true;
    riderGroup.add(torso);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), helmetMaterial);
    helmet.position.set(0, 2.0, 0.0);
    helmet.castShadow = true;
    riderGroup.add(helmet);

    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 12, 6, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.3),
      visorMaterial,
    );
    visor.position.set(0, 2.0, 0.0);
    visor.rotation.x = Math.PI * 0.08;
    riderGroup.add(visor);

    const armGeom = new THREE.CylinderGeometry(0.08, 0.07, 0.55, 8);
    for (const xSign of [-1, 1]) {
      const arm = new THREE.Mesh(armGeom, clothingMaterial);
      arm.position.set(xSign * 0.36, 1.5, -0.25);
      arm.rotation.x = -Math.PI * 0.35;
      arm.rotation.z = xSign * Math.PI * 0.08;
      arm.castShadow = true;
      riderGroup.add(arm);
    }

    const handGeom = new THREE.SphereGeometry(0.1, 8, 8);
    for (const xSign of [-1, 1]) {
      const hand = new THREE.Mesh(handGeom, skinMaterial);
      hand.position.set(xSign * 0.5, 1.3, -0.8);
      riderGroup.add(hand);
    }

    const thighGeom = new THREE.CylinderGeometry(0.11, 0.1, 0.55, 8);
    for (const xSign of [-1, 1]) {
      const thigh = new THREE.Mesh(thighGeom, clothingMaterial);
      thigh.position.set(xSign * 0.22, 1.2, 0.35);
      thigh.rotation.x = Math.PI * 0.5;
      thigh.castShadow = true;
      riderGroup.add(thigh);
    }

    const shinGeom = new THREE.CylinderGeometry(0.09, 0.07, 0.55, 8);
    for (const xSign of [-1, 1]) {
      const shin = new THREE.Mesh(shinGeom, clothingMaterial);
      shin.position.set(xSign * 0.32, 0.85, 0.4);
      shin.castShadow = true;
      riderGroup.add(shin);
    }

    bodyGroup.add(riderGroup);

    const wheelRadius = 0.5;
    const wheelThickness = 0.3;
    const tireGeom = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelThickness, 16);
    const rimGeom = new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, wheelThickness + 0.02, 12);
    const hubGeom = new THREE.CylinderGeometry(0.1, 0.1, wheelThickness + 0.04, 8);
    const tireMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 5 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 });
    const treadGeom = new THREE.BoxGeometry(wheelThickness + 0.02, 0.09, 0.14);
    const treadCount = 12;

    const createWheel = (x: number, y: number, z: number, group: THREE.Group) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);

      const wheel = new THREE.Group();

      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wheel.add(tire);

      const rim = new THREE.Mesh(rimGeom, rimMat);
      rim.rotation.z = Math.PI / 2;
      wheel.add(rim);

      const hub = new THREE.Mesh(hubGeom, rimMat);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);

      for (let i = 0; i < treadCount; i++) {
        const angle = (i / treadCount) * Math.PI * 2;
        const tread = new THREE.Mesh(treadGeom, tireMat);
        tread.position.set(0, Math.sin(angle) * wheelRadius, Math.cos(angle) * wheelRadius);
        tread.rotation.x = angle;
        wheel.add(tread);
      }

      pivot.add(wheel);
      group.add(pivot);
    };

    const wheelY = 0.5;
    const wheelX = 0.75;
    createWheel(-wheelX, wheelY, -1.0, this.frontWheels);
    createWheel(wheelX, wheelY, -1.0, this.frontWheels);
    createWheel(-wheelX, wheelY, 1.0, this.rearWheels);
    createWheel(wheelX, wheelY, 1.0, this.rearWheels);

    this.frontWheels.position.set(0, 0, 0);
    this.rearWheels.position.set(0, 0, 0);

    const launcherTube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 10), frameMaterial);
    launcherTube.position.set(0, 1.35, -0.85);
    launcherTube.rotation.x = Math.PI / 2;
    launcherTube.castShadow = true;
    this.cannon.add(launcherTube);

    const launcherMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.14, 10), frameMaterial);
    launcherMuzzle.position.set(0, 1.35, -1.32);
    launcherMuzzle.rotation.x = Math.PI / 2;
    this.cannon.add(launcherMuzzle);

    const launcherMount = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.4), frameMaterial);
    launcherMount.position.set(0, 1.22, -0.75);
    this.cannon.add(launcherMount);

    this.car.add(bodyGroup);
    this.car.add(this.cannon);
    this.car.add(this.frontWheels);
    this.car.add(this.rearWheels);

    this.car.position.copy(this.position);
  }

  getCar(): THREE.Group {
    return this.car;
  }

  getRockets(): Rocket[] {
    return this.rockets;
  }

  checkCollision(otherCar: Car): boolean {
    const myPos = this.car.position;
    const otherPos = otherCar.getCar().position;
    const minDistance = Car.COLLISION_RADIUS * 2; // Minimum distance between car centers
    
    return myPos.distanceTo(otherPos) < minDistance;
  }

  resolveCollision(otherCar: Car) {
    const myPos = this.car.position;
    const otherPos = otherCar.getCar().position;
    
    // Calculate direction and distance between cars
    const direction = new THREE.Vector3().subVectors(myPos, otherPos);
    const distance = direction.length();
    
    if (distance < Car.COLLISION_RADIUS * 2) {
      // Normalize direction and calculate overlap
      direction.normalize();
      const overlap = Car.COLLISION_RADIUS * 2 - distance;
      
      // Move cars apart based on overlap
      const moveAmount = overlap / 2;
      myPos.add(direction.multiplyScalar(moveAmount));
      
      // Stop the cars
      this.speed = 0;
    }
  }

  explode(): Explosion {
    this.isExploded = true;
    this.explosion = new Explosion(this.car.position.clone(), this.color);
    this.car.visible = false;
    this.speed = 0;
    this.turnSpeed = 0;
    return this.explosion;
  }

  respawn() {
    this.isExploded = false;
    this.explosion = null;
    this.car.visible = true;
    this.car.position.copy(this.startPosition);
    this.car.rotation.set(0, 0, 0);
    this.speed = 0;
    this.turnSpeed = 0;
  }

  private checkIfStuck(deltaTime: number): boolean {
    const currentPos = this.car.position;
    const movement = currentPos.distanceTo(this.lastPosition);
    const currentRotation = this.car.rotation.y;
    const rotationChange = Math.abs(currentRotation - this.lastRotation);
    
    // If we're barely moving or rotating while trying to move
    if (Math.abs(this.speed) > 0.1 && 
        movement < this.STUCK_THRESHOLD * deltaTime &&
        rotationChange < 0.01) {
      this.stuckTime += deltaTime;
      this.stuckRotation += rotationChange;
      if (this.stuckTime > this.STUCK_TIME) {
        return true;
      }
    } else {
      this.stuckTime = 0;
      this.stuckRotation = 0;
    }

    this.lastPosition.copy(currentPos);
    this.lastRotation = currentRotation;
    return false;
  }

  private handleStuckState(deltaTime: number) {
    if (!this.isReversing) {
      // Start reversing
      this.isReversing = true;
      this.reverseTime = 0;
      this.speed = -Math.abs(this.speed) * 2.5; // Stronger reverse (was 2)
      
      // Turn more sharply based on accumulated rotation
      if (this.stuckRotation < 0.1) {
        // If we haven't been turning much while stuck, make a sharp turn
        this.turnSpeed = (Math.random() > 0.5 ? 6 : -6); // Sharper turns (was 4)
      } else {
        // If we were trying to turn while stuck, turn the other way
        this.turnSpeed = -Math.sign(this.turnSpeed) * 6;
      }
    }

    this.reverseTime += deltaTime;
    if (this.reverseTime >= this.REVERSE_DURATION) {
      // Stop reversing
      this.isReversing = false;
      this.stuckTime = 0;
      this.stuckRotation = 0;
      this.speed = Math.abs(this.speed) * 0.8; // Better speed retention after unstuck (was 0.7)
      this.turnSpeed = (Math.random() - 0.5) * 3; // Sharper exit turn (was 2)
    }
  }

  update(deltaTime: number, otherCars: Car[] = []) {
    // Update rockets first
    this.rockets = this.rockets.filter(rocket => rocket.isAlive());
    this.rockets.forEach(rocket => rocket.update(deltaTime));

    if (this.isExploded) {
      // Update explosion if it exists
      if (this.explosion) {
        this.explosion.update(deltaTime);
      }
      return;
    }

    // Update steering angle based on turn speed
    const targetSteeringAngle = this.turnSpeed * this.MAX_STEERING_ANGLE;
    const steeringDelta = (targetSteeringAngle - this.steeringAngle) * this.STEERING_SPEED;
    this.steeringAngle += steeringDelta * deltaTime;
    this.steeringAngle = Math.max(-this.MAX_STEERING_ANGLE, 
                                 Math.min(this.MAX_STEERING_ANGLE, this.steeringAngle));

    this.wheelRotation += this.speed * this.WHEEL_ROTATION_SPEED * deltaTime;
    this.frontWheels.children.forEach(wheelPivot => {
      wheelPivot.rotation.y = this.steeringAngle;
      wheelPivot.children[0].rotation.x = this.wheelRotation;
    });
    this.rearWheels.children.forEach(wheelPivot => {
      wheelPivot.children[0].rotation.x = this.wheelRotation;
    });

    // Dynamic acceleration based on speed with better low-speed response
    if (this.speed !== this.targetSpeed) {
      const speedDiff = this.targetSpeed - this.speed;
      const accelerationRate = Math.abs(speedDiff) > 0.1 ? 
        (this.targetSpeed === 0 ? this.DECELERATION : this.ACCELERATION) : 0;
      
      const accelerationScale = Math.pow(1 - (Math.abs(this.speed) / this.MAX_SPEED), 0.7);
      const acceleration = Math.sign(speedDiff) * accelerationRate * accelerationScale * deltaTime;
      
      if (Math.abs(acceleration) > Math.abs(speedDiff)) {
        this.speed = this.targetSpeed;
      } else {
        this.speed += acceleration;
      }
    }

    // Check if we're stuck
    const isStuck = this.checkIfStuck(deltaTime);
    if (isStuck || this.isReversing) {
      this.handleStuckState(deltaTime);
    }

    const yaw = this.car.rotation.y;
    const direction = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const movement = direction.multiplyScalar(this.speed * deltaTime);
    const newPosition = this.car.position.clone().add(movement);

    // Apply the new position
    this.car.position.copy(newPosition);

    // Check collisions with other cars
    let hasCollision = false;
    for (const otherCar of otherCars) {
      if (otherCar !== this && !otherCar.isExploded && this.checkCollision(otherCar)) {
        hasCollision = true;
        this.resolveCollision(otherCar);
        break;
      }
    }

    // If there was a collision, slow down
    if (hasCollision) {
      this.speed *= 0.5;
    }

    // Apply rotation based on steering angle and speed
    if (Math.abs(this.speed) > 0.1) {
      // More direct turning - less dependent on max speed
      const speedFactor = Math.abs(this.speed) / 10; // Normalize to reasonable range
      const baseTurnRate = this.steeringAngle * this.TURN_RESPONSE * deltaTime;
      const turnAmount = baseTurnRate * Math.min(speedFactor, 1.5); // Cap the speed influence
      this.car.rotation.y += turnAmount;
    }
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.isExploded = true;
      this.explosion = new Explosion(this.car.position.clone(), this.color);
      this.debris = this.createDebris();
      this.car.visible = false;
      this.speed = 0;
      this.turnSpeed = 0;
      this.rockets = []; // Clear any remaining rockets
    }
  }

  getExplosion(): Explosion | null {
    return this.explosion;
  }

  getDebris(): THREE.Group | null {
    return this.debris;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  fireRocket(): Rocket {
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.car.quaternion);
    
    // Calculate car's velocity vector based on current speed and direction
    const carVelocity = direction.clone().multiplyScalar(this.speed);
    
    const rocketPosition = this.cannon.getWorldPosition(new THREE.Vector3());
    const rocket = new Rocket(rocketPosition, direction, carVelocity);
    this.rockets.push(rocket);
    return rocket;
  }

  setSpeed(speed: number) {
    this.targetSpeed = Math.min(Math.max(speed, this.MAX_REVERSE_SPEED), this.MAX_SPEED);
  }

  setTurnSpeed(speed: number) {
    // Speed now only affects how quickly we turn, not whether we can turn
    this.turnSpeed = speed;
  }

  public getSpeed(): number {
    return this.speed;
  }

  public getTargetSpeed(): number {
    return this.targetSpeed;
  }

  isStuck(): boolean {
    return this.isReversing || (this.stuckTime > this.STUCK_TIME);
  }

  private createDebris(): THREE.Group {
    const debris = new THREE.Group();
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshPhongMaterial({ color: this.color });

    // Create multiple debris pieces
    for (let i = 0; i < 8; i++) {
      const piece = new THREE.Mesh(geometry, material);
      piece.position.copy(this.car.position);
      
      // Random position offset
      piece.position.x += (Math.random() - 0.5) * 2;
      piece.position.y += Math.random() * 2;
      piece.position.z += (Math.random() - 0.5) * 2;

      // Random rotation
      piece.rotation.x = Math.random() * Math.PI * 2;
      piece.rotation.y = Math.random() * Math.PI * 2;
      piece.rotation.z = Math.random() * Math.PI * 2;

      debris.add(piece);
    }

    return debris;
  }
}