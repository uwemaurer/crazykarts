import * as THREE from 'three';
import { RaceTrack } from './RaceTrack';
import { Car } from './Car';
import { Rocket } from './Rocket';
import { Explosion } from './Explosion';
import * as TPane from 'tweakpane';
import { WorldGenerator } from './WorldGenerator';
import type { WorldChunk } from './WorldGenerator';

export class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private track: RaceTrack = new RaceTrack();
  private playerCar: Car = new Car(0xff0000, new THREE.Vector3(0, 0, 15));
  private buddies: Car[] = [];
  private opponents: Car[] = [];
  private clock: THREE.Clock;
  private keyStates: { [key: string]: boolean } = {};
  private titleElement: HTMLDivElement | null = null;
  private titleStartTime: number = 0;
  private debugPane!: TPane.Pane;
  private debugValues = {
    playerSpeed: 0,
    targetSpeed: 0,
    fps: 0,
    position: { x: 0, z: 0 },
    rotation: 0
  };
  private static readonly TRACK_BOUNDS = {
    front: 25,  // Half of TRACK_LENGTH - some margin
    back: -25,
    left: -8,   // Half of TRACK_WIDTH - some margin
    right: 8
  };
  private static readonly OPPONENT_BOUNDS = {
    front: 45,
    back: -45,
    left: -45,
    right: 45
  };

  private static readonly TRACK_AREA = {
    width: 20, // Track width
    length: 60, // Track length
    halfWidth: 10,
    halfLength: 30
  };

  // Game constants
  private static readonly MAX_SPEED = 40;
  private static readonly MAX_REVERSE_SPEED = -20;
  private static readonly TURN_SPEED = 3;

  private worldGenerator: WorldGenerator;
  private chunks: Map<string, WorldChunk>;
  private readonly RENDER_DISTANCE = 2;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.worldGenerator = new WorldGenerator();
    this.chunks = new Map();

    this.setupScene();
    this.setupControls();
    this.createTitleOverlay(container);
    this.setupDebugPane();

    // Initialize the world
    this.initWorld();

    // Initialize permutation table for noise
    const p = new Array(256).fill(0).map((_, i) => i);
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private createTitleOverlay(container: HTMLElement) {
    // Create title element
    this.titleElement = document.createElement('div');
    this.titleElement.style.position = 'absolute';
    this.titleElement.style.top = '20%';
    this.titleElement.style.left = '50%';
    this.titleElement.style.transform = 'translate(-50%, -50%)';
    this.titleElement.style.color = '#ffffff';
    this.titleElement.style.fontSize = '48px';
    this.titleElement.style.fontFamily = 'Arial, sans-serif';
    this.titleElement.style.fontWeight = 'bold';
    this.titleElement.style.textShadow = '2px 2px 4px rgba(0,0,0,0.5)';
    this.titleElement.style.transition = 'opacity 1s';
    this.titleElement.style.opacity = '1';
    this.titleElement.style.pointerEvents = 'none'; // Make sure it doesn't interfere with game controls
    this.titleElement.textContent = 'CrazyKarts: Rocket Rampage';
    
    container.appendChild(this.titleElement);
    this.titleStartTime = this.clock.getElapsedTime();
  }

  private updateTitle() {
    if (this.titleElement) {
      const elapsed = this.clock.getElapsedTime() - this.titleStartTime;
      if (elapsed > 2 && elapsed < 3) { // Start fading out after 2 seconds
        this.titleElement.style.opacity = String(1 - (elapsed - 2));
      } else if (elapsed >= 3) { // Remove after 3 seconds
        this.titleElement.remove();
        this.titleElement = null;
      }
    }
  }

  private setupScene() {
    // Create sky background
    const skyGeometry = new THREE.SphereGeometry(500, 60, 40);
    const skyMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x87CEEB),
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(sky);

    // Add fog for depth
    this.scene.fog = new THREE.Fog(0x87CEEB, 50, 150);

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    // Add directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    
    // Improve shadow quality
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    
    this.scene.add(directionalLight);

    // Initialize chunks around starting position
    this.initializeChunks();

    // Add player car
    this.playerCar = new Car(0xff0000, new THREE.Vector3(0, 0, 0));
    this.scene.add(this.playerCar.getCar());

    // Add buddy cars
    const buddyPositions = [
      new THREE.Vector3(-3, 0, 3),  // Left buddy
      new THREE.Vector3(3, 0, 3),   // Right buddy
    ];

    buddyPositions.forEach((position) => {
      const buddy = new Car(0x00ff00, position); // Green color for buddies
      this.buddies.push(buddy);
      this.scene.add(buddy.getCar());
    });

    // Create opponents within track boundaries
    const opponentPositions = [
      new THREE.Vector3(-8, 0, 5),  // Left side of track
      new THREE.Vector3(8, 0, 5),   // Right side of track
      new THREE.Vector3(0, 0, -5)   // Center of track
    ];

    opponentPositions.forEach((position) => {
      const opponent = new Car(0x0000ff, position);
      this.opponents.push(opponent);
      this.scene.add(opponent.getCar());
    });

    // Initial camera position
    this.camera.position.set(0, 5, 30);
    this.camera.lookAt(0, 0, 0);
  }

  private setupControls() {
    window.addEventListener('keydown', (event) => {
      this.keyStates[event.code] = true;
      
      // Handle space key press for firing rockets
      if (event.code === 'Space') {
        const carPos = this.playerCar.getCar().position;
        const rocket = this.playerCar.fireRocket();
        // Set rocket initial height to match terrain
        const rocketMesh = rocket.getRocket();
        const groundHeight = this.worldGenerator.getHeightAt(carPos.x, carPos.z);
        rocketMesh.position.y = groundHeight + 1; // Slightly above ground
        this.scene.add(rocketMesh);
      }

      // Update car controls based on current key states
      this.updateCarControls();
    });

    window.addEventListener('keyup', (event) => {
      this.keyStates[event.code] = false;
      
      // Update car controls based on current key states
      this.updateCarControls();
    });
  }

  private updateCarControls() {
    // Calculate target speed based on key states
    let targetSpeed = 0;
    if (this.keyStates['ArrowUp'] || this.keyStates['KeyW']) {
      targetSpeed = Game.MAX_SPEED;
    } else if (this.keyStates['ArrowDown'] || this.keyStates['KeyS']) {
      targetSpeed = Game.MAX_REVERSE_SPEED;
    }
    
    // Set the target speed - actual acceleration will be handled by the Car class
    this.playerCar.setSpeed(targetSpeed);

    // Handle turning
    const turnSpeed = this.keyStates['ArrowLeft'] || this.keyStates['KeyA'] ? Game.TURN_SPEED :
                     this.keyStates['ArrowRight'] || this.keyStates['KeyD'] ? -Game.TURN_SPEED :
                     0;
    this.playerCar.setTurnSpeed(turnSpeed);
  }

  private updateCamera() {
    const playerCarPosition = this.playerCar.getCar().position;
    const playerCarRotation = this.playerCar.getCar().rotation;
    const playerSpeed = Math.abs(this.playerCar.getSpeed());
    const speedFactor = playerSpeed / 150; // Based on new max speed

    // Dynamic camera position based on speed - adjusted for higher speeds
    const cameraHeight = 4 + speedFactor * 4; // Higher at high speeds (was 2)
    const cameraDistance = 12 + speedFactor * 8; // Much further back at high speeds (was 4)
    const cameraOffset = new THREE.Vector3(0, cameraHeight, cameraDistance);
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), playerCarRotation.y);
    
    // Faster camera tracking at high speeds
    const lerpFactor = 0.15 + speedFactor * 0.15; // More responsive camera (was 0.1)
    this.camera.position.lerp(playerCarPosition.clone().add(cameraOffset), lerpFactor);

    // Look much further ahead at higher speeds
    const lookAheadDistance = 15 + speedFactor * 25; // Look further ahead (was 10)
    const lookAtOffset = new THREE.Vector3(0, 0, -lookAheadDistance);
    lookAtOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), playerCarRotation.y);
    const lookAtPosition = playerCarPosition.clone().add(lookAtOffset);
    
    // Faster camera rotation at high speeds
    const currentLookAt = new THREE.Vector3();
    this.camera.getWorldDirection(currentLookAt);
    const targetLookAt = lookAtPosition.clone().sub(this.camera.position).normalize();
    currentLookAt.lerp(targetLookAt, lerpFactor);
    this.camera.lookAt(this.camera.position.clone().add(currentLookAt));
  }

  private isOnTrack(position: THREE.Vector3): boolean {
    return Math.abs(position.x) < Game.TRACK_AREA.halfWidth &&
           Math.abs(position.z) < Game.TRACK_AREA.halfLength;
  }

  private updateOpponents(deltaTime: number, allCars: Car[]) {
    this.opponents.forEach(opponent => {
      // Clean up opponent explosions and debris if they exist
      const explosion = opponent.getExplosion();
      if (explosion && !explosion.isAlive()) {
        this.scene.remove(explosion.getExplosion());
        this.scene.remove(explosion.getDebris());
      }

      if (!opponent.isDestroyed()) {
        const opponentPos = opponent.getCar().position;
        const playerPos = this.playerCar.getCar().position;
        
        // Check if opponent is near world boundaries or on track
        const nearBoundary = 
          opponentPos.z > Game.OPPONENT_BOUNDS.front ||
          opponentPos.z < Game.OPPONENT_BOUNDS.back ||
          opponentPos.x > Game.OPPONENT_BOUNDS.right ||
          opponentPos.x < Game.OPPONENT_BOUNDS.left;

        const onTrack = this.isOnTrack(opponentPos);
        const needsToTurn = nearBoundary || onTrack;

        // Calculate distance and direction to player
        const distanceToPlayer = opponentPos.distanceTo(playerPos);
        const directionToPlayer = new THREE.Vector3().subVectors(playerPos, opponentPos).normalize();
        
        // Get opponent's forward direction
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(opponent.getCar().quaternion);

        // Check if the opponent is stuck
        if (opponent.isStuck()) {
          // Let the Car class handle the unstuck behavior
          return;
        }

        if (needsToTurn) {
          if (onTrack) {
            // Get off the track quickly
            const escapeDirection = new THREE.Vector3(
              Math.sign(opponentPos.x) || (Math.random() < 0.5 ? 1 : -1),
              0,
              Math.sign(opponentPos.z) || (Math.random() < 0.5 ? 1 : -1)
            );
            const escapeAngle = Math.atan2(escapeDirection.x, escapeDirection.z);
            const currentAngle = opponent.getCar().rotation.y;
            const turnDirection = Math.sign(escapeAngle - currentAngle);
            
            opponent.setSpeed(10); // Move at moderate speed
            opponent.setTurnSpeed(turnDirection * 3); // Turn sharply
          } else {
            // Near world boundary, turn gradually
            opponent.setSpeed(opponent.getSpeed() * 0.8);
            opponent.setTurnSpeed((Math.random() - 0.5) * 3);
          }
        } else if (distanceToPlayer < 20) {
          // Calculate if the evasion path would cross the track
          const futurePos = opponentPos.clone().add(
            directionToPlayer.clone().multiplyScalar(5)
          );
          
          if (!this.isOnTrack(futurePos)) {
            // Safe to evade
            opponent.setSpeed(12);
            const evasionDirection = Math.sign(opponentPos.x - playerPos.x);
            opponent.setTurnSpeed(evasionDirection * 2);
          } else {
            // Would cross track, move parallel to it instead
            const parallelDirection = Math.sign(opponentPos.z - playerPos.z);
            opponent.setTurnSpeed(parallelDirection * 1.5);
            opponent.setSpeed(10);
          }
        } else {
          // Normal cruising on green area
          const cruisingSpeed = 8 + Math.random() * 4;
          opponent.setSpeed(cruisingSpeed);
          
          // Gentle turns that tend to run parallel to the track
          const preferredAngle = Math.abs(opponentPos.x) > Game.TRACK_AREA.halfWidth * 1.5 ?
            Math.sign(opponentPos.z) * Math.PI / 2 : // Move parallel to track when far from it
            Math.sign(opponentPos.x) * Math.PI; // Move away from track when closer
            
          const angleDiff = (preferredAngle - opponent.getCar().rotation.y) % (Math.PI * 2);
          opponent.setTurnSpeed(Math.sign(angleDiff) * 1);
        }
      }
      
      opponent.update(deltaTime, allCars);
    });
  }

  private setupDebugPane() {
    this.debugPane = new TPane.Pane({
      title: 'Debug Values',
      expanded: true
    });

    // Add player speed monitor
    this.debugPane.addBinding(this.debugValues, 'playerSpeed', {
      readonly: true,
      label: 'Current Speed',
      format: (v: number) => Math.abs(v).toFixed(1) + ' units/s'
    });

    // Add target speed monitor
    this.debugPane.addBinding(this.debugValues, 'targetSpeed', {
      readonly: true,
      label: 'Target Speed',
      format: (v: number) => Math.abs(v).toFixed(1) + ' units/s'
    });

    // Add FPS monitor
    this.debugPane.addBinding(this.debugValues, 'fps', {
      readonly: true,
      label: 'FPS',
      format: (v: number) => v.toFixed(0)
    });

    // Add position folder
    const positionFolder = this.debugPane.addFolder({
      title: 'Position',
      expanded: false
    });

    positionFolder.addBinding(this.debugValues.position, 'x', {
      readonly: true,
      format: (v: number) => v.toFixed(1)
    });
    positionFolder.addBinding(this.debugValues.position, 'z', {
      readonly: true,
      format: (v: number) => v.toFixed(1)
    });

    // Add rotation monitor
    this.debugPane.addBinding(this.debugValues, 'rotation', {
      readonly: true,
      label: 'Rotation',
      format: (v: number) => (v * 180 / Math.PI).toFixed(1) + '°'
    });

    // Position the debug pane in the top-right corner
    const element = this.debugPane.element;
    element.style.position = 'absolute';
    element.style.top = '10px';
    element.style.right = '10px';
  }

  private initWorld() {
    // Create initial chunks around (0,0)
    for (let x = -this.RENDER_DISTANCE; x <= this.RENDER_DISTANCE; x++) {
      for (let z = -this.RENDER_DISTANCE; z <= this.RENDER_DISTANCE; z++) {
        this.createChunk(x, z);
      }
    }
  }

  private createChunk(x: number, z: number) {
    const chunk = this.worldGenerator.generateChunk(x, z);
    this.chunks.set(this.getChunkKey(x, z), chunk);
    this.scene.add(chunk.mesh);
  }

  // Perlin noise implementation
  private noise(x: number, y: number): number {
    // Simple 2D noise function
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    // Smooth interpolation
    const u = this.fade(x);
    const v = this.fade(y);
    
    // Hash coordinates
    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;
    
    // Mix final hash values
    return this.lerp(
      this.lerp(this.grad(this.perm[A], x, y), this.grad(this.perm[B], x - 1, y), u),
      this.lerp(this.grad(this.perm[A + 1], x, y - 1), this.grad(this.perm[B + 1], x - 1, y - 1), u),
      v
    );
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 15;
    const grad = 1 + (h & 7);
    return ((h & 8) ? -grad : grad) * x + ((h & 4) ? -grad : grad) * y;
  }

  private smoothStep(edge0: number, edge1: number, x: number): number {
    x = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return x * x * (3 - 2 * x);
  }

  // Permutation table for noise
  private readonly perm = new Array(512);

  private initializeChunks() {
    const startX = Math.floor(this.playerCar.getCar().position.x / this.worldGenerator.getChunkSize());
    const startZ = Math.floor(this.playerCar.getCar().position.z / this.worldGenerator.getChunkSize());

    for (let x = -this.RENDER_DISTANCE; x <= this.RENDER_DISTANCE; x++) {
      for (let z = -this.RENDER_DISTANCE; z <= this.RENDER_DISTANCE; z++) {
        const chunkX = startX + x;
        const chunkZ = startZ + z;
        this.loadChunk(chunkX, chunkZ);
      }
    }
  }

  private loadChunk(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ);
    if (!this.chunks.has(key)) {
      const chunk = this.worldGenerator.generateChunk(chunkX, chunkZ);
      this.chunks.set(key, chunk);
      this.scene.add(chunk.mesh);
    }
  }

  private unloadChunk(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ);
    const chunk = this.chunks.get(key);
    if (chunk) {
      this.scene.remove(chunk.mesh);
      this.chunks.delete(key);
    }
  }

  private updateChunks() {
    const playerPos = this.playerCar.getCar().position;
    const currentChunkX = Math.floor(playerPos.x / this.worldGenerator.getChunkSize());
    const currentChunkZ = Math.floor(playerPos.z / this.worldGenerator.getChunkSize());

    // Load new chunks
    for (let x = -this.RENDER_DISTANCE; x <= this.RENDER_DISTANCE; x++) {
      for (let z = -this.RENDER_DISTANCE; z <= this.RENDER_DISTANCE; z++) {
        const chunkX = currentChunkX + x;
        const chunkZ = currentChunkZ + z;
        this.loadChunk(chunkX, chunkZ);
      }
    }

    // Unload far chunks
    for (const [key, chunk] of this.chunks.entries()) {
      const [x, z] = key.split(',').map(Number);
      const distance = Math.max(
        Math.abs(x - currentChunkX),
        Math.abs(z - currentChunkZ)
      );
      if (distance > this.RENDER_DISTANCE) {
        this.unloadChunk(x, z);
      }
    }
  }

  private getChunkKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  private updateBuddies(deltaTime: number, allCars: Car[]) {
    const playerPos = this.playerCar.getCar().position;
    const playerRotation = this.playerCar.getCar().rotation.y;
    const playerSpeed = this.playerCar.getSpeed();
    const playerForward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerRotation);

    this.buddies.forEach((buddy, index) => {
      // Calculate desired formation position relative to player
      const sideOffset = index === 0 ? -5 : 5; // Wider spacing
      const backOffset = -3; // Slightly behind player
      
      // Calculate desired position in world space
      const desiredPos = playerPos.clone()
        .add(new THREE.Vector3(
          playerForward.x * backOffset - playerForward.z * sideOffset,
          0,
          playerForward.z * backOffset + playerForward.x * sideOffset
        ));

      // Calculate direction and distance to desired position
      const buddyPos = buddy.getCar().position;
      const direction = desiredPos.clone().sub(buddyPos);
      const distance = direction.length();

      // Match player's shooting with slight delay for each buddy
      if (this.keyStates['Space']) {
        setTimeout(() => {
          const rocket = buddy.fireRocket();
          const rocketMesh = rocket.getRocket();
          const groundHeight = this.worldGenerator.getHeightAt(buddyPos.x, buddyPos.z);
          rocketMesh.position.y = groundHeight + 1;
          this.scene.add(rocketMesh);
        }, index * 100); // 100ms delay between buddy shots
      }

      // Adjust speed and turning based on position relative to player
      if (distance > 0.5) {
        // Calculate target angle to desired position
        const targetAngle = Math.atan2(direction.x, direction.z);
        const currentAngle = buddy.getCar().rotation.y;
        let angleDiff = (targetAngle - currentAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI;

        // Smoother turning
        const turnSpeed = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff * 2), Game.TURN_SPEED);
        
        // Adjust speed based on distance and angle
        const speedFactor = Math.cos(angleDiff); // Reduce speed when turning sharply
        const targetSpeed = Math.min(
          distance * 8, // Faster catch-up
          Math.max(playerSpeed * speedFactor, Game.MAX_SPEED)
        );

        buddy.setTurnSpeed(turnSpeed);
        buddy.setSpeed(targetSpeed);
      } else {
        // When in position, match player's rotation and speed
        buddy.getCar().rotation.y = playerRotation;
        buddy.setSpeed(playerSpeed);
        buddy.setTurnSpeed(0);
      }

      // Update buddy physics
      buddy.update(deltaTime, allCars);

      // Keep buddy on ground
      const groundHeight = this.worldGenerator.getHeightAt(buddyPos.x, buddyPos.z);
      buddyPos.y = groundHeight + 0.5;
    });
  }

  public animate() {
    const deltaTime = this.clock.getDelta();
    
    // Update debug values
    const currentSpeed = this.playerCar.getSpeed();
    const targetSpeed = this.playerCar.getTargetSpeed();
    
    this.debugValues.playerSpeed = currentSpeed;
    this.debugValues.targetSpeed = targetSpeed;
    this.debugValues.fps = 1 / deltaTime;
    this.debugValues.position.x = this.playerCar.getCar().position.x;
    this.debugValues.position.z = this.playerCar.getCar().position.z;
    this.debugValues.rotation = this.playerCar.getCar().rotation.y;

    // Update title if it exists
    this.updateTitle();

    // Get all cars for collision checking
    const allCars = [this.playerCar, ...this.buddies, ...this.opponents];

    // Update player car with collision checking
    this.playerCar.update(deltaTime, allCars);

    // Keep car on ground
    const carPos = this.playerCar.getCar().position;
    const groundHeight = this.worldGenerator.getHeightAt(carPos.x, carPos.z);
    carPos.y = groundHeight + 0.5;

    // Update buddies
    this.updateBuddies(deltaTime, allCars);

    // Update rockets and check collisions
    const allRockets = [
      ...this.playerCar.getRockets(),
      ...this.buddies.flatMap(buddy => buddy.getRockets())
    ];

    for (let i = allRockets.length - 1; i >= 0; i--) {
      const rocket = allRockets[i];
      
      // Update rocket first
      rocket.update(deltaTime);
      
      // Keep rocket at proper height
      if (!rocket.hasExploded()) {
        const rocketPos = rocket.getPosition();
        const groundHeight = this.worldGenerator.getHeightAt(rocketPos.x, rocketPos.z);
        rocketPos.y = groundHeight + 1; // Keep rocket slightly above ground
      }
      
      // If rocket is dead, clean it up and continue
      if (!rocket.isAlive()) {
        const rocketExplosion = rocket.getExplosion();
        if (rocketExplosion) {
          this.scene.remove(rocketExplosion.getExplosion());
        }
        this.scene.remove(rocket.getRocket());
        allRockets.splice(i, 1);
        continue;
      }

      // Only check collisions if rocket hasn't exploded yet
      if (!rocket.hasExploded()) {
        // Check collisions with opponent cars
        let hasCollided = false;
        for (const opponent of this.opponents) {
          if (!opponent.isDestroyed() && rocket.checkCollision(opponent)) {
            hasCollided = true;
            
            // Create rocket explosion first
            rocket.explode();
            const rocketExplosion = rocket.getExplosion();
            if (rocketExplosion) {
              this.scene.add(rocketExplosion.getExplosion());
            }

            // Then handle opponent destruction
            opponent.destroy();
            const opponentExplosion = opponent.getExplosion();
            if (opponentExplosion) {
              this.scene.add(opponentExplosion.getExplosion());
            }
            break;
          }
        }

        // Only check environment collisions if no car collision occurred
        if (!hasCollided) {
          const collision = this.track.checkRocketCollision(rocket.getPosition());
          if (collision.object) {
            rocket.explode();
            if (collision.type === 'tree') {
              this.track.setTreeOnFire(collision.object as THREE.Group);
            }
            const rocketExplosion = rocket.getExplosion();
            if (rocketExplosion) {
              this.scene.add(rocketExplosion.getExplosion());
            }
          }
        }
      }
    }

    // Update and cleanup opponents
    for (let i = this.opponents.length - 1; i >= 0; i--) {
      const opponent = this.opponents[i];
      
      if (opponent.isDestroyed()) {
        const explosion = opponent.getExplosion();
        if (explosion && explosion.isAlive()) {
          explosion.update(deltaTime);
        } else if (explosion) {
          // If explosion is done, remove everything
          this.scene.remove(opponent.getCar());
          this.scene.remove(explosion.getExplosion());
          const debris = opponent.getDebris();
          if (debris) {
            this.scene.remove(debris);
          }
          // Remove the opponent from the array
          this.opponents.splice(i, 1);
          
          // Create a new opponent at a random position
          const angle = Math.random() * Math.PI * 2;
          const radius = 30 + Math.random() * 10; // Random distance from center
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const newOpponent = new Car(0x0000ff, new THREE.Vector3(x, 0, z));
          this.opponents.push(newOpponent);
          this.scene.add(newOpponent.getCar());
        }
      } else {
        // Update opponent behavior
        const opponentPos = opponent.getCar().position;
        const playerPos = this.playerCar.getCar().position;
        
        // Check if opponent is near world boundaries or on track
        const nearBoundary = 
          opponentPos.z > Game.OPPONENT_BOUNDS.front ||
          opponentPos.z < Game.OPPONENT_BOUNDS.back ||
          opponentPos.x > Game.OPPONENT_BOUNDS.right ||
          opponentPos.x < Game.OPPONENT_BOUNDS.left;

        const onTrack = this.isOnTrack(opponentPos);
        const needsToTurn = nearBoundary || onTrack;

        // Calculate distance and direction to player
        const distanceToPlayer = opponentPos.distanceTo(playerPos);
        
        if (opponent.isStuck()) {
          // Let the Car class handle the unstuck behavior
          opponent.update(deltaTime, allCars);
          continue;
        }

        if (needsToTurn) {
          if (onTrack) {
            // Get off the track quickly
            const escapeDirection = new THREE.Vector3(
              Math.sign(opponentPos.x) || (Math.random() < 0.5 ? 1 : -1),
              0,
              Math.sign(opponentPos.z) || (Math.random() < 0.5 ? 1 : -1)
            );
            const escapeAngle = Math.atan2(escapeDirection.x, escapeDirection.z);
            const currentAngle = opponent.getCar().rotation.y;
            const turnDirection = Math.sign(escapeAngle - currentAngle);
            
            opponent.setSpeed(10);
            opponent.setTurnSpeed(turnDirection * 3);
          } else {
            // Near world boundary, turn gradually
            opponent.setSpeed(opponent.getSpeed() * 0.8);
            opponent.setTurnSpeed((Math.random() - 0.5) * 3);
          }
        } else if (distanceToPlayer < 20) {
          // Evade player
          const evasionDirection = Math.sign(opponentPos.x - playerPos.x);
          opponent.setSpeed(12);
          opponent.setTurnSpeed(evasionDirection * 2);
        } else {
          // Normal cruising
          opponent.setSpeed(8 + Math.random() * 4);
          opponent.setTurnSpeed((Math.random() - 0.5) * 1.5);
        }

        // Update physics and collisions
        opponent.update(deltaTime, allCars);
      }
    }

    // Update camera position and rotation
    this.updateCamera();

    // Update track (for burning trees)
    this.track.update(deltaTime);

    // Update world chunks based on player position
    this.updateChunks();

    // Render scene
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }

  public handleResize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}