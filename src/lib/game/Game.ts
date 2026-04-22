import * as THREE from 'three';
import { RaceTrack } from './RaceTrack';
import { Car } from './Car';
import { Rocket } from './Rocket';
import { Explosion } from './Explosion';
import { Zombie } from './Zombie';
import { MegaZombie } from './MegaZombie';
import { Slime } from './Slime';
import { Trash } from './Trash';
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
  private zombies: Zombie[] = [];
  private megaZombies: MegaZombie[] = [];
  private slimes: Slime[] = [];
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
  private static readonly MAX_SPEED = 25; // Reduced from 40 for better control
  private static readonly MAX_REVERSE_SPEED = -15; // Reduced from -20
  private static readonly TURN_SPEED = 1; // Normalized turn input (will be multiplied by steering angle)

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

    // Buddies and opponents removed - only player and zombies now

    // Spawn zombies around the world
    const zombieCount = 10;
    for (let i = 0; i < zombieCount; i++) {
      const angle = (i / zombieCount) * Math.PI * 2;
      const radius = 15 + Math.random() * 20;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const zombie = new Zombie(new THREE.Vector3(x, 0, z));
      this.zombies.push(zombie);
      this.scene.add(zombie.getZombie());
    }

    // Spawn 2 mega zombies
    const megaZombieCount = 2;
    for (let i = 0; i < megaZombieCount; i++) {
      const angle = (i / megaZombieCount) * Math.PI * 2 + Math.PI; // Offset from regular zombies
      const radius = 25 + Math.random() * 15;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const megaZombie = new MegaZombie(new THREE.Vector3(x, 0, z));
      this.megaZombies.push(megaZombie);
      this.scene.add(megaZombie.getZombie());
    }

    // Initial camera position
    this.camera.position.set(0, 5, 30);
    this.camera.lookAt(0, 0, 0);
  }

  private setupControls() {
    window.addEventListener('keydown', (event) => {
      this.keyStates[event.code] = true;
      
      // Handle space key press for firing rockets
      if (event.code === 'Space') {
        const rocket = this.playerCar.fireRocket();
        // Rocket position is already set by fireRocket() from cannon position
        this.scene.add(rocket.getRocket());
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

    // Update player car (no other cars to collide with)
    this.playerCar.update(deltaTime, []);

    // Keep car on ground
    const carPos = this.playerCar.getCar().position;
    const groundHeight = this.worldGenerator.getHeightAt(carPos.x, carPos.z);
    carPos.y = groundHeight + 0.5;

    // Update rockets and check collisions
    const allRockets = this.playerCar.getRockets();

    for (let i = allRockets.length - 1; i >= 0; i--) {
      const rocket = allRockets[i];

      // Update rocket first
      rocket.update(deltaTime);

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
        const rocketPos = rocket.getPosition();
        const groundHeight = this.worldGenerator.getHeightAt(rocketPos.x, rocketPos.z);

        // Check if rocket hit the ground
        if (rocketPos.y <= groundHeight + 0.2) {
          rocket.explode();
          const rocketExplosion = rocket.getExplosion();
          if (rocketExplosion) {
            this.scene.add(rocketExplosion.getExplosion());
          }
          continue;
        }

        // Check environment collisions (trees, etc)
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

    // Update zombies
    const playerPos = this.playerCar.getCar().position;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const zombie = this.zombies[i];

      if (zombie.isDestroyed()) {
        // Remove destroyed zombie and all its trash
        this.scene.remove(zombie.getZombie());
        const thrownTrash = zombie.getThrownTrash();
        for (const trash of thrownTrash) {
          this.scene.remove(trash.getTrash());
        }
        this.zombies.splice(i, 1);

        // Spawn a new zombie at a random position away from player
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + Math.random() * 20;
        const x = playerPos.x + Math.cos(angle) * radius;
        const z = playerPos.z + Math.sin(angle) * radius;
        const newZombie = new Zombie(new THREE.Vector3(x, 0, z));
        this.zombies.push(newZombie);
        this.scene.add(newZombie.getZombie());
        continue;
      }

      // Update zombie to chase player (with collision avoidance from other zombies)
      zombie.update(deltaTime, playerPos, this.zombies);

      // Keep zombie on ground
      const zombiePos = zombie.getPosition();
      const groundHeight = this.worldGenerator.getHeightAt(zombiePos.x, zombiePos.z);
      zombiePos.y = groundHeight;

      // Handle zombie's thrown trash
      const thrownTrash = zombie.getThrownTrash();
      for (let j = thrownTrash.length - 1; j >= 0; j--) {
        const trash = thrownTrash[j];

        // Add newly thrown trash to scene
        if (!trash.getTrash().parent) {
          this.scene.add(trash.getTrash());
        }

        // Update trash
        const trashPos = trash.getPosition();
        const trashGroundHeight = this.worldGenerator.getHeightAt(trashPos.x, trashPos.z);
        trash.update(deltaTime, trashGroundHeight);

        // Check collision with player
        if (trash.isAlive() && trash.checkCollision(playerPos, 1.5)) {
          trash.destroy();
          this.scene.remove(trash.getTrash());

          // Slow down player slightly when hit by trash
          const playerSpeed = this.playerCar.getSpeed();
          this.playerCar.setSpeed(playerSpeed * 0.85);
        }

        // Remove dead trash
        if (!trash.isAlive()) {
          this.scene.remove(trash.getTrash());
        }
      }

      // Cleanup dead trash from zombie's array
      zombie.cleanupTrash();

      // Check collision with player
      if (zombie.checkCollision(playerPos, 2.5)) {
        const playerSpeed = this.playerCar.getSpeed();

        // If player is moving fast, run over the zombie
        if (Math.abs(playerSpeed) > 10) {
          zombie.destroy();

          // Create slime effect at zombie position
          const slime = new Slime(zombiePos.clone());
          this.slimes.push(slime);
          this.scene.add(slime.getSlime());
        } else {
          // Push zombie away from player
          const pushDirection = new THREE.Vector3().subVectors(zombiePos, playerPos);
          pushDirection.y = 0;
          pushDirection.normalize();

          // Push zombie away
          const pushDistance = 2;
          zombiePos.add(pushDirection.multiplyScalar(pushDistance));

          // Slightly slow down player (but not too much)
          this.playerCar.setSpeed(playerSpeed * 0.8);
        }
      }

      // Check if zombie is hit by rockets
      for (const rocket of allRockets) {
        if (!rocket.hasExploded() && zombie.checkCollision(rocket.getPosition(), 1)) {
          zombie.destroy();

          // Create rocket explosion
          rocket.explode();
          const rocketExplosion = rocket.getExplosion();
          if (rocketExplosion) {
            this.scene.add(rocketExplosion.getExplosion());
          }

          // Create slime effect at zombie position
          const slime = new Slime(zombiePos.clone());
          this.slimes.push(slime);
          this.scene.add(slime.getSlime());

          break;
        }
      }
    }

    // Update and cleanup slime effects
    for (let i = this.slimes.length - 1; i >= 0; i--) {
      const slime = this.slimes[i];
      slime.update(deltaTime);

      if (!slime.isAlive()) {
        this.scene.remove(slime.getSlime());
        this.slimes.splice(i, 1);
      }
    }

    // Update mega zombies
    for (let i = this.megaZombies.length - 1; i >= 0; i--) {
      const megaZombie = this.megaZombies[i];

      if (megaZombie.isDestroyed()) {
        // Remove destroyed mega zombie
        this.scene.remove(megaZombie.getZombie());
        this.megaZombies.splice(i, 1);

        // Spawn a new mega zombie at a random position away from player
        const angle = Math.random() * Math.PI * 2;
        const radius = 40 + Math.random() * 20;
        const x = playerPos.x + Math.cos(angle) * radius;
        const z = playerPos.z + Math.sin(angle) * radius;
        const newMegaZombie = new MegaZombie(new THREE.Vector3(x, 0, z));
        this.megaZombies.push(newMegaZombie);
        this.scene.add(newMegaZombie.getZombie());
        continue;
      }

      // Update mega zombie to chase player (with collision avoidance from all zombies)
      const allZombies = [...this.zombies, ...this.megaZombies];
      megaZombie.update(deltaTime, playerPos, allZombies);

      // Keep mega zombie on ground
      const megaZombiePos = megaZombie.getPosition();
      const groundHeight = this.worldGenerator.getHeightAt(megaZombiePos.x, megaZombiePos.z);
      megaZombiePos.y = groundHeight;

      // Check collision with player
      if (megaZombie.checkCollision(playerPos, 2.5)) {
        const playerSpeed = this.playerCar.getSpeed();

        // Mega zombie is harder to run over - need higher speed
        if (Math.abs(playerSpeed) > 20) {
          megaZombie.destroy();

          // Create slime effect at mega zombie position
          const slime = new Slime(megaZombiePos.clone());
          this.slimes.push(slime);
          this.scene.add(slime.getSlime());
        } else {
          // Push player away from mega zombie (mega zombie is stronger)
          const pushDirection = new THREE.Vector3().subVectors(playerPos, megaZombiePos);
          pushDirection.y = 0;
          pushDirection.normalize();

          // Push player away
          const pushDistance = 3;
          playerPos.add(pushDirection.multiplyScalar(pushDistance));

          // Slow down player significantly
          this.playerCar.setSpeed(playerSpeed * 0.6);
        }
      }

      // Check if mega zombie's club hits the player during attack
      if (megaZombie.isAttackingPlayer() && megaZombie.checkCollision(playerPos, megaZombie.getAttackRange())) {
        const playerSpeed = this.playerCar.getSpeed();

        // Club hit! Knock player back and slow them down significantly
        const knockbackDirection = new THREE.Vector3().subVectors(playerPos, megaZombiePos);
        knockbackDirection.y = 0;
        knockbackDirection.normalize();

        // Strong knockback
        playerPos.add(knockbackDirection.multiplyScalar(5));

        // Significant speed reduction
        this.playerCar.setSpeed(playerSpeed * 0.3);

        // Mark that this attack has landed (prevents multiple hits)
        megaZombie.markAttackHit();
      }

      // Check if mega zombie is hit by rockets
      for (const rocket of allRockets) {
        if (!rocket.hasExploded() && megaZombie.checkCollision(rocket.getPosition(), 1)) {
          // Mega zombie takes 3 rocket hits to destroy (just destroy on any hit for now)
          megaZombie.destroy();

          // Create rocket explosion
          rocket.explode();
          const rocketExplosion = rocket.getExplosion();
          if (rocketExplosion) {
            this.scene.add(rocketExplosion.getExplosion());
          }

          // Create slime effect at mega zombie position
          const slime = new Slime(megaZombiePos.clone());
          this.slimes.push(slime);
          this.scene.add(slime.getSlime());

          break;
        }
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