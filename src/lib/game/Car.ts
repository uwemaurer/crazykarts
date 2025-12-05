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
    // Main body group to hold all bicycle parts
    const bodyGroup = new THREE.Group();
    
    // Create frame
    const frameGroup = new THREE.Group();
    
    // Main frame tube (from seat to pedals)
    const seatTubeGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8);
    const frameMaterial = new THREE.MeshStandardMaterial({ 
      color: color,
      metalness: 0.8,
      roughness: 0.2
    });
    const seatTube = new THREE.Mesh(seatTubeGeometry, frameMaterial);
    seatTube.position.y = 0.8;
    seatTube.rotation.x = -Math.PI * 0.15;
    frameGroup.add(seatTube);

    // Top tube (from seat to handlebars)
    const topTubeGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
    const topTube = new THREE.Mesh(topTubeGeometry, frameMaterial);
    topTube.position.set(0, 1.1, -0.3);
    topTube.rotation.z = Math.PI / 2;
    frameGroup.add(topTube);

    // Down tube (from pedals to handlebars)
    const downTubeGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8);
    const downTube = new THREE.Mesh(downTubeGeometry, frameMaterial);
    downTube.position.set(0, 0.7, -0.3);
    downTube.rotation.x = Math.PI * 0.3;
    frameGroup.add(downTube);

    // Handlebar stem
    const stemGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8);
    const stem = new THREE.Mesh(stemGeometry, frameMaterial);
    stem.position.set(0, 1.2, -0.6);
    frameGroup.add(stem);

    // Handlebars
    const handlebarGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8);
    const handlebar = new THREE.Mesh(handlebarGeometry, frameMaterial);
    handlebar.position.set(0, 1.4, -0.6);
    handlebar.rotation.z = Math.PI / 2;
    frameGroup.add(handlebar);

    // Seat
    const seatGeometry = new THREE.BoxGeometry(0.2, 0.05, 0.4);
    const seatMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 });
    const seat = new THREE.Mesh(seatGeometry, seatMaterial);
    seat.position.set(0, 1.2, 0.2);
    frameGroup.add(seat);

    // Pedal system
    const pedalHubGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16);
    const pedalHub = new THREE.Mesh(pedalHubGeometry, frameMaterial);
    pedalHub.position.set(0, 0.4, 0);
    pedalHub.rotation.z = Math.PI / 2;
    frameGroup.add(pedalHub);

    // Pedals
    const pedalGeometry = new THREE.BoxGeometry(0.1, 0.02, 0.2);
    const leftPedal = new THREE.Mesh(pedalGeometry, seatMaterial);
    leftPedal.position.set(-0.2, 0.4, 0);
    frameGroup.add(leftPedal);

    const rightPedal = new THREE.Mesh(pedalGeometry, seatMaterial);
    rightPedal.position.set(0.2, 0.4, 0);
    frameGroup.add(rightPedal);

    bodyGroup.add(frameGroup);

    // Create rider
    const riderGroup = new THREE.Group();
    
    // Rider body material
    const riderMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x2244aa,  // Blue clothing
      shininess: 30 
    });
    const skinMaterial = new THREE.MeshPhongMaterial({ 
      color: 0xffcc99,  // Skin tone
      shininess: 30 
    });

    // Torso (leaning forward)
    const torsoGeometry = new THREE.BoxGeometry(0.3, 0.4, 0.2);
    const torso = new THREE.Mesh(torsoGeometry, riderMaterial);
    torso.position.set(0, 1.2, 0);
    torso.rotation.x = Math.PI * 0.25; // Lean forward
    riderGroup.add(torso);

    // Head
    const headGeometry = new THREE.SphereGeometry(0.15, 16, 16);
    const head = new THREE.Mesh(headGeometry, skinMaterial);
    head.position.set(0, 1.5, -0.1);
    riderGroup.add(head);

    // Arms
    const armGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8);
    
    // Left arm
    const leftArm = new THREE.Mesh(armGeometry, skinMaterial);
    leftArm.position.set(-0.2, 1.3, -0.3);
    leftArm.rotation.z = -Math.PI * 0.15;
    leftArm.rotation.x = Math.PI * 0.25;
    riderGroup.add(leftArm);

    // Right arm
    const rightArm = new THREE.Mesh(armGeometry, skinMaterial);
    rightArm.position.set(0.2, 1.3, -0.3);
    rightArm.rotation.z = Math.PI * 0.15;
    rightArm.rotation.x = Math.PI * 0.25;
    riderGroup.add(rightArm);

    // Legs
    const thighGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8);
    const calfGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);

    // Left leg
    const leftThigh = new THREE.Mesh(thighGeometry, riderMaterial);
    leftThigh.position.set(-0.12, 0.9, 0.1);
    leftThigh.rotation.x = -Math.PI * 0.4;
    riderGroup.add(leftThigh);

    const leftCalf = new THREE.Mesh(calfGeometry, riderMaterial);
    leftCalf.position.set(-0.12, 0.6, 0);
    leftCalf.rotation.x = Math.PI * 0.2;
    riderGroup.add(leftCalf);

    // Right leg
    const rightThigh = new THREE.Mesh(thighGeometry, riderMaterial);
    rightThigh.position.set(0.12, 0.9, 0.1);
    rightThigh.rotation.x = -Math.PI * 0.4;
    riderGroup.add(rightThigh);

    const rightCalf = new THREE.Mesh(calfGeometry, riderMaterial);
    rightCalf.position.set(0.12, 0.6, 0);
    rightCalf.rotation.x = Math.PI * 0.2;
    riderGroup.add(rightCalf);

    // Add rider to the bicycle
    bodyGroup.add(riderGroup);

    // Create wheels with spokes
    const wheelRadius = 0.5;
    const wheelThickness = 0.1;
    const wheelGeometry = new THREE.TorusGeometry(wheelRadius, wheelThickness, 8, 24);
    const wheelMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x222222,
      shininess: 30
    });
    const rimMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x888888,
      metalness: 0.8,
      roughness: 0.2
    });

    // Function to create a wheel with spokes
    const createWheel = (x: number, y: number, z: number, group: THREE.Group) => {
      const wheelPivot = new THREE.Group();
      wheelPivot.position.set(x, y, z);
      
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.y = Math.PI / 2;
      wheel.castShadow = true;

      // Add spokes
      const spokeCount = 8;
      for (let i = 0; i < spokeCount; i++) {
        const spokeGeometry = new THREE.CylinderGeometry(0.01, 0.01, wheelRadius * 2, 4);
        const spoke = new THREE.Mesh(spokeGeometry, rimMaterial);
        spoke.rotation.z = (Math.PI / spokeCount) * i;
        wheel.add(spoke);
      }

      wheelPivot.add(wheel);
      group.add(wheelPivot);
    };

    // Create wheels
    createWheel(0, 0.5, -0.6, this.frontWheels); // Front wheel
    createWheel(0, 0.5, 0.6, this.rearWheels);   // Rear wheel

    // Position the wheel groups at the bicycle's center
    this.frontWheels.position.set(0, 0, 0);
    this.rearWheels.position.set(0, 0, 0);

    // Add cannon (mounted on handlebars)
    const cannonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
    const cannonMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333,
      metalness: 0.8,
      roughness: 0.2
    });
    const cannonMesh = new THREE.Mesh(cannonGeometry, cannonMaterial);
    cannonMesh.rotation.x = Math.PI / 2;
    cannonMesh.position.y = 1.4;
    cannonMesh.position.z = -0.8;
    this.cannon.add(cannonMesh);

    // Add all parts to the bicycle
    this.car.add(bodyGroup);
    this.car.add(this.cannon);
    this.car.add(this.frontWheels);
    this.car.add(this.rearWheels);

    // Set initial position
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

    // Update front wheels visual rotation for steering
    this.frontWheels.rotation.y = this.steeringAngle;

    // Update wheel rotation based on speed
    this.wheelRotation += this.speed * this.WHEEL_ROTATION_SPEED * deltaTime;
    // Apply wheel rotation around their local X axis
    this.frontWheels.children.forEach(wheelPivot => {
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

    // Calculate movement based on current speed and steering angle
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.car.quaternion);
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