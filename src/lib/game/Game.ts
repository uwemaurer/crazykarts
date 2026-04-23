import * as THREE from 'three';
import * as TPane from 'tweakpane';
import { WorldGenerator } from './WorldGenerator';
import type { PlanBlock, Village, WorldChunk } from './WorldGenerator';
import { Animal, createChicken, createDeer, createPig } from './Animal';
import { Villager, type Profession, type VillageEconomy } from './Villager';
import { Sfx } from './Sfx';
import { Player } from './Player';
import { Inventory, blockLabel } from './Inventory';
import { InventoryHud } from './InventoryHud';
import { BlockHighlight } from './BlockHighlight';
import { ViewModel } from './ViewModel';
import { AIR, BLOCK_TEXTURES, LEAVES, WOOD, type BlockId } from './voxel/BlockTypes';
import { getTileTexture } from './voxel/TextureGenerator';
import gsap from 'gsap';
import { SaveManager, type SaveData, type SavedVillage } from './SaveManager';

function randomPointAround(origin: THREE.Vector3, minRadius: number, maxRadius: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2;
  const radius = minRadius + Math.random() * (maxRadius - minRadius);
  return new THREE.Vector3(origin.x + Math.cos(angle) * radius, 0, origin.z + Math.sin(angle) * radius);
}

export class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;

  private player!: Player;
  private inventory = new Inventory();
  private inventoryHud!: InventoryHud;
  private highlight = new BlockHighlight();
  private viewModel = new ViewModel();
  private placementGhost = new BlockHighlight({
    edgeColor: 0x66ff88,
    edgeOpacity: 0.7,
    fillColor: 0x66ff88,
    fillOpacity: 0.08,
    boxScale: 0.98,
  });
  private targeted: { wx: number; wy: number; wz: number; nx: number; ny: number; nz: number; block: BlockId } | null = null;
  private reticle!: HTMLDivElement;
  private hintElement!: HTMLDivElement;
  private pointerLocked = false;

  private animals: Animal[] = [];
  private villagers: Villager[] = [];
  private activatedVillageKeys: Set<string> = new Set();
  private villageConstructionQueues: Map<string, PlanBlock[]> = new Map();
  private villageEconomies: Map<string, VillageEconomy> = new Map();
  private villageCenters: Map<string, THREE.Vector3> = new Map();
  private economyHud!: HTMLDivElement;
  private villagerSpawnAccum = 0;
  private readonly ANIMAL_COUNT_CHICKEN = 10;
  private readonly ANIMAL_COUNT_PIG = 6;
  private readonly ANIMAL_COUNT_DEER = 5;
  private readonly VILLAGE_ACTIVATION_RADIUS = 140;
  private readonly MAX_VILLAGERS = 75;
  private readonly REACH = 5;

  private clock: THREE.Clock;
  private keyStates: { [key: string]: boolean } = {};
  private touchForward = 0;
  private touchStrafe = 0;
  private titleElement: HTMLDivElement | null = null;
  private titleStartTime = 0;
  private debugPane!: TPane.Pane;
  private debugValues = {
    fps: 0,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: false,
  };

  private sfx = new Sfx(0.45);
  private wasGrounded = true;

  private worldGenerator: WorldGenerator;
  private nearChunks: Map<string, WorldChunk> = new Map();
  private farChunks: Map<string, WorldChunk> = new Map();
  private savedVillageStates: Map<string, SavedVillage> = new Map();
  private saveIntervalId: number | null = null;
  private readonly SAVE_INTERVAL_MS = 15000;
  private readonly RENDER_DISTANCE_NEAR = 4;
  private readonly RENDER_DISTANCE_FAR = 10;
  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapImageData!: ImageData;
  private minimapFrame = 0;
  private static readonly MINIMAP_SIZE = 140;
  private static readonly MINIMAP_RADIUS = 70;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.clock = new THREE.Clock();
    const saved = SaveManager.load();
    this.worldGenerator = new WorldGenerator(saved?.seed);
    if (saved?.diffs) this.worldGenerator.loadDiffs(saved.diffs);
    if (saved?.villages) {
      for (const [k, v] of Object.entries(saved.villages)) {
        this.savedVillageStates.set(k, v);
      }
    }
    this.sfx.attachUnlock(window);
    this.setupScene(saved);
    if (saved?.inventory) this.inventory.load(saved.inventory);
    this.setupControls();
    this.createTitleOverlay(container, !!saved);
    this.createReticle(container);
    this.createHint(container);
    this.setupDebugPane();
    this.setupMinimap(container);
    this.setupEconomyHud(container);
    this.inventoryHud = new InventoryHud(container, this.inventory);
    this.inventoryHud.render();
    this.spawnAnimals();
    this.attachSaveHooks();
  }

  private createTitleOverlay(container: HTMLElement, restored: boolean) {
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
    this.titleElement.style.pointerEvents = 'none';
    this.titleElement.style.textAlign = 'center';
    this.titleElement.innerHTML = restored
      ? 'Voxel World<br><span style="font-size:18px;font-weight:normal;opacity:0.85">World restored · F6 to reset</span>'
      : 'Voxel World';
    container.appendChild(this.titleElement);
    this.titleStartTime = this.clock.getElapsedTime();
  }

  private createReticle(container: HTMLElement) {
    this.reticle = document.createElement('div');
    this.reticle.style.position = 'absolute';
    this.reticle.style.left = '50%';
    this.reticle.style.top = '50%';
    this.reticle.style.width = '4px';
    this.reticle.style.height = '4px';
    this.reticle.style.marginLeft = '-2px';
    this.reticle.style.marginTop = '-2px';
    this.reticle.style.borderRadius = '50%';
    this.reticle.style.background = 'rgba(255,255,255,0.9)';
    this.reticle.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.6)';
    this.reticle.style.pointerEvents = 'none';
    this.reticle.style.zIndex = '6';
    container.appendChild(this.reticle);
  }

  private createHint(container: HTMLElement) {
    this.hintElement = document.createElement('div');
    this.hintElement.style.position = 'absolute';
    this.hintElement.style.top = '50%';
    this.hintElement.style.left = '50%';
    this.hintElement.style.transform = 'translate(-50%, 40px)';
    this.hintElement.style.padding = '8px 14px';
    this.hintElement.style.borderRadius = '6px';
    this.hintElement.style.background = 'rgba(0,0,0,0.6)';
    this.hintElement.style.color = 'white';
    this.hintElement.style.font = '13px/1.3 Arial, sans-serif';
    this.hintElement.style.pointerEvents = 'none';
    this.hintElement.style.zIndex = '7';
    this.hintElement.style.opacity = '0';
    this.hintElement.style.transition = 'opacity 0.2s';
    container.appendChild(this.hintElement);
  }

  private updateTitle() {
    if (this.titleElement) {
      const elapsed = this.clock.getElapsedTime() - this.titleStartTime;
      if (elapsed > 2 && elapsed < 3) {
        this.titleElement.style.opacity = String(1 - (elapsed - 2));
      } else if (elapsed >= 3) {
        this.titleElement.remove();
        this.titleElement = null;
      }
    }
  }

  private setupScene(saved: SaveData | null) {
    const skyGeometry = new THREE.SphereGeometry(500, 60, 40);
    const skyMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x87CEEB),
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(sky);

    this.scene.fog = new THREE.Fog(0x87CEEB, 60, 180);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -80;
    directionalLight.shadow.camera.right = 80;
    directionalLight.shadow.camera.top = 80;
    directionalLight.shadow.camera.bottom = -80;
    this.scene.add(directionalLight);

    this.initializeChunks();

    let spawn: THREE.Vector3;
    if (saved?.player) {
      spawn = new THREE.Vector3(saved.player.x, saved.player.y, saved.player.z);
    } else {
      spawn = new THREE.Vector3(0, this.worldGenerator.getHeightAt(0, 0), 0);
    }
    this.player = new Player(spawn);
    if (saved?.player) {
      this.player.yaw = saved.player.yaw;
      this.player.pitch = saved.player.pitch;
    }
    this.player.applyToCamera(this.camera);

    this.scene.add(this.highlight.getObject());
    this.scene.add(this.placementGhost.getObject());
    // Camera must be in the scene graph for its children (viewmodel) to render.
    this.scene.add(this.camera);
    this.camera.add(this.viewModel.getObject());
  }

  private setupControls() {
    window.addEventListener('keydown', (event) => {
      // Number keys select hotbar slots.
      if (event.code.startsWith('Digit')) {
        const n = parseInt(event.code.slice(5), 10);
        if (n >= 1 && n <= 9) {
          this.inventory.selectSlot(n - 1);
          event.preventDefault();
          return;
        }
      }
      if (event.code === 'KeyE') {
        this.tryHelpBuild();
        event.preventDefault();
        return;
      }
      if (event.code === 'F3') {
        event.preventDefault();
        this.debugWireframe = !this.debugWireframe;
        this.worldGenerator.setWireframe(this.debugWireframe);
        return;
      }
      if (event.code === 'F6') {
        event.preventDefault();
        this.resetWorld();
        return;
      }
      this.keyStates[event.code] = true;
    });

    window.addEventListener('keyup', (event) => {
      this.keyStates[event.code] = false;
    });

    // Pointer lock on click.
    this.canvas.addEventListener('click', () => {
      if (!this.pointerLocked) this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked) return;
      this.player.addLook(event.movementX, event.movementY);
    });

    // Mouse buttons trigger mine/place only while locked; before lock, click just captures.
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('mousedown', (event) => {
      if (!this.pointerLocked) return;
      if (event.button === 0) this.mineTargeted();
      else if (event.button === 2) this.placeAtTargeted();
    });

    this.canvas.addEventListener('wheel', (event) => {
      if (!this.pointerLocked) return;
      this.inventory.cycle(event.deltaY > 0 ? 1 : -1);
      event.preventDefault();
    }, { passive: false });
  }

  private updateCamera() {
    this.player.applyToCamera(this.camera);
  }

  public setTouchInput(strafe: number, forward: number) {
    this.touchStrafe = Math.max(-1, Math.min(1, strafe));
    this.touchForward = Math.max(-1, Math.min(1, forward));
  }

  public primaryAction() {
    this.mineTargeted();
  }

  private gatherInput() {
    const kbForward =
      (this.keyStates['ArrowUp'] || this.keyStates['KeyW'] ? 1 : 0) -
      (this.keyStates['ArrowDown'] || this.keyStates['KeyS'] ? 1 : 0);
    const kbStrafe =
      (this.keyStates['ArrowRight'] || this.keyStates['KeyD'] ? 1 : 0) -
      (this.keyStates['ArrowLeft'] || this.keyStates['KeyA'] ? 1 : 0);

    const forward = kbForward !== 0 ? kbForward : this.touchForward;
    const strafe = kbStrafe !== 0 ? kbStrafe : this.touchStrafe;

    return {
      forward,
      strafe,
      jump: !!this.keyStates['Space'],
      sprint: !!this.keyStates['ShiftLeft'] || !!this.keyStates['ShiftRight'],
    };
  }

  private setupDebugPane() {
    const isTouch = typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768);
    if (isTouch) return;

    this.debugPane = new TPane.Pane({ title: 'Debug', expanded: false });
    this.debugPane.addBinding(this.debugValues, 'fps', {
      readonly: true, label: 'FPS', format: (v: number) => v.toFixed(0),
    });
    const positionFolder = this.debugPane.addFolder({ title: 'Position', expanded: false });
    positionFolder.addBinding(this.debugValues.position, 'x', { readonly: true, format: (v: number) => v.toFixed(1) });
    positionFolder.addBinding(this.debugValues.position, 'y', { readonly: true, format: (v: number) => v.toFixed(2) });
    positionFolder.addBinding(this.debugValues.position, 'z', { readonly: true, format: (v: number) => v.toFixed(1) });
    this.debugPane.addBinding(this.debugValues, 'yaw', { readonly: true, format: (v: number) => (v * 180 / Math.PI).toFixed(0) + '°' });
    this.debugPane.addBinding(this.debugValues, 'pitch', { readonly: true, format: (v: number) => (v * 180 / Math.PI).toFixed(0) + '°' });
    this.debugPane.addBinding(this.debugValues, 'grounded', { readonly: true });

    const element = this.debugPane.element;
    element.style.position = 'absolute';
    element.style.top = '10px';
    element.style.right = '10px';
  }

  private spawnAnimals() {
    const origin = this.player.position;
    const getGroundY = (x: number, z: number) => this.worldGenerator.getHeightAt(x, z);

    const spawn = (count: number, factory: (home: THREE.Vector3) => Animal, minR: number, maxR: number) => {
      for (let i = 0; i < count; i++) {
        const pos = randomPointAround(origin, minR, maxR);
        pos.y = getGroundY(pos.x, pos.z);
        const animal = factory(pos);
        this.animals.push(animal);
        this.scene.add(animal.getGroup());
      }
    };

    spawn(this.ANIMAL_COUNT_CHICKEN, createChicken, 8, 60);
    spawn(this.ANIMAL_COUNT_PIG, createPig, 12, 70);
    spawn(this.ANIMAL_COUNT_DEER, createDeer, 20, 90);
  }

  private villageKey(v: Village): string {
    return `${v.rx},${v.rz}`;
  }

  private activateVillage(v: Village) {
    const key = this.villageKey(v);
    if (this.activatedVillageKeys.has(key)) return;
    if (this.villagers.length >= this.MAX_VILLAGERS) return;
    this.activatedVillageKeys.add(key);

    const home = new THREE.Vector3(v.x, v.floorY, v.z);
    this.villageCenters.set(key, home.clone());

    const savedState = this.savedVillageStates.get(key);
    const economy: VillageEconomy = savedState
      ? { ...savedState.economy }
      : { lumber: 3, stone: 3, food: 8, money: 15 };
    this.villageEconomies.set(key, economy);

    const pending: PlanBlock[] = savedState
      ? savedState.pending.map(([wx, wy, wz, block]) => ({ wx, wy, wz, block }))
      : this.worldGenerator.getPendingConstructionBlocks(v);
    this.villageConstructionQueues.set(key, pending);

    const placeBlock = (b: PlanBlock): boolean =>
      this.worldGenerator.placeBlock(b.wx, b.wy, b.wz, b.block);

    const getWorkSpot = (prof: Profession): THREE.Vector3 => {
      const r = 20 + Math.random() * 10;
      switch (prof) {
        case 'farmer': {
          const c = this.worldGenerator.getFarmCenter(v);
          const jx = (Math.random() - 0.5) * 3;
          const jz = (Math.random() - 0.5) * 3;
          return new THREE.Vector3(c.x + jx, v.floorY, c.z + jz);
        }
        case 'builder': {
          const c = this.worldGenerator.getConstructionSiteCenter(v);
          return new THREE.Vector3(c.x + 3.5, v.floorY, c.z + 3.5);
        }
        case 'hunter': {
          let target: THREE.Vector3 | null = null;
          let best = 55;
          for (const a of this.animals) {
            if (!a.isAlive()) continue;
            const p = a.getPosition();
            const d = Math.hypot(p.x - v.x, p.z - v.z);
            if (d < best) { best = d; target = p; }
          }
          if (target) return new THREE.Vector3(target.x, v.floorY, target.z);
          const angle = Math.random() * Math.PI;
          return new THREE.Vector3(v.x + Math.cos(angle) * r, v.floorY, v.z + Math.sin(angle) * r);
        }
        case 'lumberjack': {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
          return new THREE.Vector3(v.x + Math.cos(angle) * r, v.floorY, v.z + Math.sin(angle) * r);
        }
        case 'stonecutter': {
          const angle = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
          return new THREE.Vector3(v.x + Math.cos(angle) * r, v.floorY, v.z + Math.sin(angle) * r);
        }
      }
    };

    const huntNearby = (pos: THREE.Vector3, range: number): boolean => {
      let nearest: Animal | null = null;
      let bestDist = range;
      for (const a of this.animals) {
        if (!a.isAlive()) continue;
        const d = a.getPosition().distanceTo(pos);
        if (d < bestDist) { bestDist = d; nearest = a; }
      }
      if (nearest) { nearest.destroy(); return true; }
      return false;
    };

    const ctx = { economy, getWorkSpot, placeBlock, pendingBlocks: pending, huntNearby };

    const professions: Profession[] = ['farmer', 'hunter', 'lumberjack', 'stonecutter', 'builder'];
    for (const prof of professions) {
      if (this.villagers.length >= this.MAX_VILLAGERS) break;
      const villager = new Villager(prof, home, ctx);
      this.villagers.push(villager);
      this.scene.add(villager.getGroup());
    }
  }

  private updateVillagerSpawn(deltaTime: number) {
    this.villagerSpawnAccum += deltaTime;
    if (this.villagerSpawnAccum < 1) return;
    this.villagerSpawnAccum = 0;
    const playerPos = this.player.position;
    const villages = this.worldGenerator.getVillagesNear(
      playerPos.x, playerPos.z, this.VILLAGE_ACTIVATION_RADIUS,
    );
    for (const v of villages) this.activateVillage(v);
  }

  private setupEconomyHud(container: HTMLElement) {
    const hud = document.createElement('div');
    hud.style.position = 'absolute';
    hud.style.top = '168px';
    hud.style.left = '12px';
    hud.style.padding = '8px 12px';
    hud.style.background = 'rgba(0, 0, 0, 0.62)';
    hud.style.color = 'white';
    hud.style.font = '12px/1.4 Arial, sans-serif';
    hud.style.borderRadius = '6px';
    hud.style.minWidth = '160px';
    hud.style.pointerEvents = 'none';
    hud.style.zIndex = '5';
    hud.style.whiteSpace = 'pre';
    hud.textContent = '';
    container.appendChild(hud);
    this.economyHud = hud;
  }

  private updateEconomyHud() {
    if (!this.economyHud) return;
    const playerPos = this.player.position;
    let nearestKey: string | null = null;
    let nearestDist = Infinity;
    for (const [key, center] of this.villageCenters) {
      const d = Math.hypot(center.x - playerPos.x, center.z - playerPos.z);
      if (d < nearestDist) { nearestDist = d; nearestKey = key; }
    }
    if (!nearestKey || nearestDist > 160) {
      this.economyHud.style.opacity = '0.45';
      this.economyHud.textContent = 'No village nearby';
      return;
    }
    const econ = this.villageEconomies.get(nearestKey)!;
    const pending = this.villageConstructionQueues.get(nearestKey);
    const buildLeft = pending ? pending.length : 0;
    this.economyHud.style.opacity = '1';
    this.economyHud.textContent =
      `Village  ${Math.round(nearestDist)}m\n` +
      `Lumber   ${econ.lumber}\n` +
      `Stone    ${econ.stone}\n` +
      `Food     ${econ.food}\n` +
      `Money    $${econ.money}\n` +
      `To build ${buildLeft}`;
  }

  private setupMinimap(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.width = Game.MINIMAP_SIZE;
    canvas.height = Game.MINIMAP_SIZE;
    canvas.style.position = 'absolute';
    canvas.style.top = '12px';
    canvas.style.left = '12px';
    canvas.style.width = Game.MINIMAP_SIZE + 'px';
    canvas.style.height = Game.MINIMAP_SIZE + 'px';
    canvas.style.border = '2px solid rgba(255, 255, 255, 0.55)';
    canvas.style.borderRadius = '50%';
    canvas.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.5)';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    container.appendChild(canvas);
    this.minimapCanvas = canvas;
    this.minimapCtx = canvas.getContext('2d')!;
    this.minimapImageData = this.minimapCtx.createImageData(Game.MINIMAP_SIZE, Game.MINIMAP_SIZE);
  }

  private drawMinimap() {
    this.minimapFrame++;
    if (this.minimapFrame % 6 !== 0) return;

    const size = Game.MINIMAP_SIZE;
    const radius = Game.MINIMAP_RADIUS;
    const worldPerPixel = (radius * 2) / size;
    const playerPos = this.player.position;
    const data = this.minimapImageData.data;

    const baseWx = playerPos.x - radius;
    const baseWz = playerPos.z - radius;

    for (let py = 0; py < size; py++) {
      const wz = baseWz + py * worldPerPixel;
      for (let px = 0; px < size; px++) {
        const wx = baseWx + px * worldPerPixel;
        const c = this.worldGenerator.sampleMinimap(wx, wz);
        const idx = (py * size + px) * 4;
        data[idx] = c.r;
        data[idx + 1] = c.g;
        data[idx + 2] = c.b;
        data[idx + 3] = 255;
      }
    }

    this.minimapCtx.putImageData(this.minimapImageData, 0, 0);

    const ctx = this.minimapCtx;
    const cx = size / 2;
    const cy = size / 2;

    for (const a of this.animals) {
      const p = a.getPosition();
      const sx = cx + (p.x - playerPos.x) / worldPerPixel;
      const sy = cy + (p.z - playerPos.z) / worldPerPixel;
      if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue;
      ctx.fillStyle = a.kind === 'chicken' ? '#f4f4d8' : a.kind === 'pig' ? '#f0b3a8' : '#c08950';
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }

    for (const v of this.villagers) {
      const p = v.getPosition();
      const sx = cx + (p.x - playerPos.x) / worldPerPixel;
      const sy = cy + (p.z - playerPos.z) / worldPerPixel;
      if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue;
      ctx.fillStyle =
        v.profession === 'farmer' ? '#8cd04a'
        : v.profession === 'builder' ? '#ffd24a'
        : v.profession === 'lumberjack' ? '#a8723c'
        : v.profession === 'stonecutter' ? '#bcc4cf'
        : '#5a8f55';
      ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }

    const rotation = this.player.yaw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rotation);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#ffe03d';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#1a1a1a';
    ctx.stroke();
    ctx.restore();
  }

  private initializeChunks() {
    this.syncChunkRings(0, 0);
  }

  private loadNearChunk(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ);
    if (this.nearChunks.has(key)) return;
    const chunk = this.worldGenerator.generateChunk(chunkX, chunkZ);
    this.nearChunks.set(key, chunk);
    this.scene.add(chunk.mesh);
  }

  private unloadNearChunk(key: string) {
    const chunk = this.nearChunks.get(key);
    if (!chunk) return;
    this.scene.remove(chunk.mesh);
    this.nearChunks.delete(key);
    const [cx, cz] = key.split(',').map(Number);
    this.worldGenerator.disposeChunkFull(cx, cz);
  }

  private loadFarChunk(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ);
    if (this.farChunks.has(key)) return;
    const chunk = this.worldGenerator.generateChunkLOD1(chunkX, chunkZ);
    this.farChunks.set(key, chunk);
    this.scene.add(chunk.mesh);
  }

  private unloadFarChunk(key: string) {
    const chunk = this.farChunks.get(key);
    if (!chunk) return;
    this.scene.remove(chunk.mesh);
    this.farChunks.delete(key);
    const [cx, cz] = key.split(',').map(Number);
    this.worldGenerator.disposeChunkLOD1(cx, cz);
  }

  private updateChunks() {
    const playerPos = this.player.position;
    const chunkSize = this.worldGenerator.getChunkSize();
    const currentChunkX = Math.floor(playerPos.x / chunkSize);
    const currentChunkZ = Math.floor(playerPos.z / chunkSize);
    this.syncChunkRings(currentChunkX, currentChunkZ);
  }

  private syncChunkRings(currentChunkX: number, currentChunkZ: number) {
    const wantedNear = new Set<string>();
    const wantedFar = new Set<string>();
    const farR = this.RENDER_DISTANCE_FAR;
    const nearR = this.RENDER_DISTANCE_NEAR;

    for (let dx = -farR; dx <= farR; dx++) {
      for (let dz = -farR; dz <= farR; dz++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dz));
        if (dist > farR) continue;
        const cx = currentChunkX + dx;
        const cz = currentChunkZ + dz;
        const key = this.getChunkKey(cx, cz);
        if (dist <= nearR) wantedNear.add(key);
        else wantedFar.add(key);
      }
    }

    // Unload near chunks that no longer belong in the near ring.
    for (const key of [...this.nearChunks.keys()]) {
      if (!wantedNear.has(key)) this.unloadNearChunk(key);
    }
    // Promote/load near chunks.
    for (const key of wantedNear) {
      if (this.nearChunks.has(key)) continue;
      if (this.farChunks.has(key)) this.unloadFarChunk(key);
      const [cx, cz] = key.split(',').map(Number);
      this.loadNearChunk(cx, cz);
    }
    // Unload far chunks that are out of range or now served by near.
    for (const key of [...this.farChunks.keys()]) {
      if (!wantedFar.has(key) || this.nearChunks.has(key)) this.unloadFarChunk(key);
    }
    // Load missing far chunks.
    for (const key of wantedFar) {
      if (this.farChunks.has(key) || this.nearChunks.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      this.loadFarChunk(cx, cz);
    }
  }

  private getChunkKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  private animationStarted = false;
  private debugWireframe = false;

  public animate() {
    if (!this.animationStarted) {
      this.clock.getDelta();
      this.animationStarted = true;
    }
    const deltaTime = Math.min(this.clock.getDelta(), 0.05);

    this.updateTitle();

    this.player.update(deltaTime, this.gatherInput(),
      (wx, wy, wz) => this.worldGenerator.getBlock(wx, wy, wz) !== AIR);

    if (this.player.didJump) this.sfx.play('jump');
    this.wasGrounded = this.player.grounded;

    this.updateCamera();
    this.updateChunks();
    this.updateTargeted();

    this.updateAnimals(deltaTime);
    this.updateVillagers(deltaTime);
    this.updateVillagerSpawn(deltaTime);

    this.drawMinimap();
    this.updateEconomyHud();
    this.inventoryHud.render();
    this.syncViewModel();
    this.updateHint();

    // Debug values.
    this.debugValues.fps = 1 / deltaTime;
    this.debugValues.position.x = this.player.position.x;
    this.debugValues.position.y = this.player.position.y;
    this.debugValues.position.z = this.player.position.z;
    this.debugValues.yaw = this.player.yaw;
    this.debugValues.pitch = this.player.pitch;
    this.debugValues.grounded = this.player.grounded;

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }

  private updateAnimals(deltaTime: number) {
    const playerPos = this.player.position;
    const getGroundY = (x: number, z: number) => this.worldGenerator.getHeightAt(x, z);

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      a.update(deltaTime, playerPos, getGroundY);

      if (!a.isAlive()) {
        this.scene.remove(a.getGroup());
        this.animals.splice(i, 1);
        const spawn = randomPointAround(playerPos, 40, 90);
        spawn.y = getGroundY(spawn.x, spawn.z);
        const factory = a.kind === 'chicken' ? createChicken : a.kind === 'pig' ? createPig : createDeer;
        const replacement = factory(spawn);
        this.animals.push(replacement);
        this.scene.add(replacement.getGroup());
      }
    }
  }

  private updateVillagers(deltaTime: number) {
    const getGroundY = (x: number, z: number) => this.worldGenerator.getHeightAt(x, z);
    for (const v of this.villagers) v.update(deltaTime, getGroundY);
  }

  private updateTargeted() {
    const hit = this.worldGenerator.raycastBlock(this.player.eye, this.player.forward, this.REACH);
    this.targeted = hit;
    if (!hit) {
      this.highlight.hide();
      this.placementGhost.hide();
      return;
    }
    this.highlight.setTarget(hit.wx, hit.wy, hit.wz);
    this.autoSwitchTool(hit.block);

    const selected = this.inventory.getSelected();
    if (selected && selected.item.kind === 'block' && this.placementInFlight === 0) {
      const px = hit.wx + hit.nx;
      const py = hit.wy + hit.ny;
      const pz = hit.wz + hit.nz;
      const canPlace = !this.blockIntersectsPlayer(px, py, pz)
        && this.worldGenerator.getBlock(px, py, pz) === AIR;
      if (canPlace) this.placementGhost.setTarget(px, py, pz);
      else this.placementGhost.hide();
    } else {
      this.placementGhost.hide();
    }
  }

  private syncViewModel() {
    const selected = this.inventory.getSelected();
    if (!selected) { this.viewModel.setKind('none'); return; }
    if (selected.item.kind === 'tool') {
      this.viewModel.setKind(selected.item.tool);
    } else {
      this.viewModel.setKind('block', selected.item.block);
    }
  }

  private lastDesiredTool: 'axe' | 'pickaxe' | null = null;
  private autoSwitchTool(targetedBlock: BlockId) {
    const desired: 'axe' | 'pickaxe' =
      targetedBlock === WOOD || targetedBlock === LEAVES ? 'axe' : 'pickaxe';
    // Only act on a transition — otherwise we'd overwrite the user's manual selection every frame.
    if (desired === this.lastDesiredTool) return;
    this.lastDesiredTool = desired;

    const selected = this.inventory.getSelected();
    if (!selected || selected.item.kind !== 'tool') return;
    if (selected.item.tool === desired) return;
    for (let i = 0; i < this.inventory.size(); i++) {
      const s = this.inventory.getSlot(i);
      if (s && s.item.kind === 'tool' && s.item.tool === desired) {
        this.inventory.selectSlot(i);
        return;
      }
    }
  }

  private mineTargeted() {
    if (!this.targeted) return;
    const { wx, wy, wz, block } = this.targeted;
    if (block === AIR) return;
    const ok = this.worldGenerator.placeBlock(wx, wy, wz, AIR);
    if (!ok) return;
    this.inventory.addBlock(block, 1);
    this.sfx.play('mine');
    this.viewModel.swing();
  }

  private placementInFlight = 0;

  private placeAtTargeted() {
    if (!this.targeted) return;
    const selected = this.inventory.getSelected();
    if (!selected || selected.item.kind !== 'block') {
      this.flashHint('Select a block to place');
      return;
    }
    const { wx, wy, wz, nx, ny, nz } = this.targeted;
    const px = wx + nx;
    const py = wy + ny;
    const pz = wz + nz;
    if (this.blockIntersectsPlayer(px, py, pz)) return;
    if (this.worldGenerator.getBlock(px, py, pz) !== AIR) return;

    const block = selected.item.block;
    // Consume inventory immediately so the player can't queue infinite throws;
    // block is actually placed when the toss animation lands.
    this.inventory.consumeSelectedBlock();
    this.sfx.play('place');
    this.viewModel.swing();
    this.tossBlockToTarget(block, px, py, pz);
  }

  private tossBlockToTarget(block: BlockId, wx: number, wy: number, wz: number) {
    this.placementInFlight++;

    const tex = BLOCK_TEXTURES[block];
    const sideMap = getTileTexture(tex ? tex.side : 0);
    const topMap = getTileTexture(tex ? tex.top : 0);
    const bottomMap = getTileTexture(tex ? tex.bottom : 0);
    const mats = [
      new THREE.MeshLambertMaterial({ map: sideMap, fog: false }),
      new THREE.MeshLambertMaterial({ map: sideMap, fog: false }),
      new THREE.MeshLambertMaterial({ map: topMap, fog: false }),
      new THREE.MeshLambertMaterial({ map: bottomMap, fog: false }),
      new THREE.MeshLambertMaterial({ map: sideMap, fog: false }),
      new THREE.MeshLambertMaterial({ map: sideMap, fog: false }),
    ];
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geom, mats);

    // Release the block from just in front of the viewmodel's world position,
    // as if it's leaving the hand.
    const from = new THREE.Vector3();
    this.viewModel.getObject().getWorldPosition(from);
    from.addScaledVector(this.player.forward, 0.35);

    mesh.position.copy(from);
    mesh.scale.setScalar(0.28);
    // Random tumble axis so consecutive throws don't look identical.
    const spinX = (Math.random() * 2 + 1.5) * (Math.random() < 0.5 ? 1 : -1);
    const spinZ = (Math.random() * 2 + 1.0) * (Math.random() < 0.5 ? 1 : -1);
    this.scene.add(mesh);

    const to = new THREE.Vector3(wx + 0.5, wy + 0.5, wz + 0.5);
    const distance = from.distanceTo(to);
    // Apex height scales with throw distance so a close toss doesn't loop up too far.
    const apex = Math.max(from.y, to.y) + Math.min(1.6, 0.45 + distance * 0.22);
    const duration = 0.18 + Math.min(0.25, distance * 0.04);
    const riseTime = duration * 0.45;
    const fallTime = duration - riseTime;

    const finalize = () => {
      const stillAir = this.worldGenerator.getBlock(wx, wy, wz) === AIR;
      if (stillAir) {
        this.worldGenerator.placeBlock(wx, wy, wz, block);
      } else {
        // Target got filled by something else (villager); give the block back.
        this.inventory.addBlock(block, 1);
      }
      this.scene.remove(mesh);
      geom.dispose();
      for (const m of mats) m.dispose();
      this.placementInFlight--;
    };

    const tl = gsap.timeline({ onComplete: finalize });

    // Parabolic arc: rise to apex (decelerating, like an upward throw), then
    // fall to target (accelerating, gravity-ish).
    tl.to(mesh.position, {
      x: (from.x + to.x) * 0.5,
      y: apex,
      z: (from.z + to.z) * 0.5,
      duration: riseTime,
      ease: 'power2.out',
    }, 0);
    tl.to(mesh.position, {
      x: to.x,
      y: to.y,
      z: to.z,
      duration: fallTime,
      ease: 'power2.in',
    }, riseTime);

    // Grow from in-hand size to full block over the flight.
    tl.to(mesh.scale, {
      x: 1, y: 1, z: 1,
      duration,
      ease: 'power1.out',
    }, 0);

    // Continuous tumble during flight.
    tl.to(mesh.rotation, {
      x: Math.PI * spinX,
      z: Math.PI * spinZ,
      duration,
      ease: 'none',
    }, 0);

    // Impact squash-and-settle as it lands.
    tl.to(mesh.scale, { x: 1.18, y: 0.85, z: 1.18, duration: 0.06, ease: 'power1.out' }, duration);
    tl.to(mesh.rotation, { x: 0, y: 0, z: 0, duration: 0.06, ease: 'power1.out' }, duration);
    tl.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.06, ease: 'power2.inOut' }, duration + 0.06);
  }

  private blockIntersectsPlayer(bx: number, by: number, bz: number): boolean {
    const p = this.player.position;
    const r = this.player.getBodyRadius();
    const h = this.player.getBodyHeight();
    const minX = bx, maxX = bx + 1;
    const minY = by, maxY = by + 1;
    const minZ = bz, maxZ = bz + 1;
    const pMinX = p.x - r, pMaxX = p.x + r;
    const pMinY = p.y, pMaxY = p.y + h;
    const pMinZ = p.z - r, pMaxZ = p.z + r;
    return pMinX < maxX && pMaxX > minX
      && pMinY < maxY && pMaxY > minY
      && pMinZ < maxZ && pMaxZ > minZ;
  }

  private tryHelpBuild() {
    const playerPos = this.player.position;
    let bestKey: string | null = null;
    let bestDist = 20;
    for (const [key, center] of this.villageCenters) {
      const d = Math.hypot(center.x - playerPos.x, center.z - playerPos.z);
      if (d < bestDist) { bestDist = d; bestKey = key; }
    }
    if (!bestKey) { this.flashHint('No village nearby'); return; }

    const queue = this.villageConstructionQueues.get(bestKey);
    if (!queue || queue.length === 0) { this.flashHint('Nothing to build'); return; }

    // Find the first queued block whose material the player actually has.
    let pickedIndex = -1;
    for (let i = 0; i < queue.length; i++) {
      if (this.inventory.hasBlock(queue[i].block)) { pickedIndex = i; break; }
    }
    if (pickedIndex === -1) {
      const needed = queue[0].block;
      this.flashHint(`Need ${blockLabel(needed)} to help build`);
      return;
    }
    const b = queue[pickedIndex];
    if (!this.inventory.consumeBlock(b.block)) return;
    const ok = this.worldGenerator.placeBlock(b.wx, b.wy, b.wz, b.block);
    if (!ok) { this.inventory.addBlock(b.block, 1); return; }
    queue.splice(pickedIndex, 1);
    this.sfx.play('pickup');
    this.flashHint(`Placed ${blockLabel(b.block)}`);
  }

  private hintTimer = 0;
  private updateHint() {
    if (this.hintTimer > 0) {
      this.hintTimer -= 1 / 60;
      if (this.hintTimer <= 0) this.hintElement.style.opacity = '0';
    }
  }
  private flashHint(text: string) {
    this.hintElement.textContent = text;
    this.hintElement.style.opacity = '1';
    this.hintTimer = 1.8;
  }

  public handleResize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private attachSaveHooks(): void {
    this.saveIntervalId = window.setInterval(() => this.save(), this.SAVE_INTERVAL_MS);
    window.addEventListener('beforeunload', this.save);
    document.addEventListener('visibilitychange', this.saveOnHide);
  }

  private save = (): void => {
    const villages: Record<string, SavedVillage> = {};
    for (const [key, econ] of this.villageEconomies) {
      const queue = this.villageConstructionQueues.get(key) ?? [];
      villages[key] = {
        economy: { ...econ },
        pending: queue.map(b => [b.wx, b.wy, b.wz, b.block]),
      };
    }
    const data: SaveData = {
      version: 1,
      seed: this.worldGenerator.getInputSeed(),
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
      },
      inventory: this.inventory.serialize(),
      diffs: this.worldGenerator.serializeDiffs(),
      villages,
    };
    SaveManager.save(data);
  };

  private saveOnHide = (): void => {
    if (document.hidden) this.save();
  };

  private resetWorld(): void {
    if (this.saveIntervalId !== null) {
      window.clearInterval(this.saveIntervalId);
      this.saveIntervalId = null;
    }
    window.removeEventListener('beforeunload', this.save);
    document.removeEventListener('visibilitychange', this.saveOnHide);
    SaveManager.clear();
    window.location.reload();
  }
}
