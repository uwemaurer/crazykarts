import * as THREE from 'three';
import * as TPane from 'tweakpane';
import { WorldGenerator } from './WorldGenerator';
import type { PlanBlock, Village, WorldChunk } from './WorldGenerator';
import { Animal, createChicken, createDeer, createPig } from './Animal';
import { Villager, type Profession, type VillageEconomy } from './Villager';
import { PoliceStation, type PoliceStationContext } from './PoliceStation';
import { HouseInterior } from './HouseInterior';
import { Companion, type CarryLoad, type CompanionContext, type GatherType } from './Companion';
import { Sfx } from './Sfx';
import { Player } from './Player';
import { Inventory, blockLabel } from './Inventory';
import { InventoryHud } from './InventoryHud';
import { BlockHighlight } from './BlockHighlight';
import { ViewModel } from './ViewModel';
import { AIR, BLOCK_TEXTURES, COAL_ORE, DIRT, GOLD_ORE, GRASS, IRON_ORE, LEAVES, SAND, STONE, WOOD, type BlockId } from './voxel/BlockTypes';
import { getTileTexture } from './voxel/TextureGenerator';
import gsap from 'gsap';
import { SaveManager, type SaveData, type SavedVillage } from './SaveManager';
import { SkySystem } from './SkySystem';
import { GrassSystem } from './GrassSystem';
import { FrameStats } from './FrameStats';

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
  private policeStations: PoliceStation[] = [];
  private activatedStationKeys: Set<string> = new Set();
  private stationSpawnAccum = 0;
  private clickRaycaster = new THREE.Raycaster();
  private houseInteriors: HouseInterior[] = [];
  private bedPromptElement!: HTMLDivElement;
  private sleepOverlay!: HTMLDivElement;
  private sleeping = false;

  private companion: Companion | null = null;
  private commandMode = false;
  private commandBuffer = '';
  private commandBoxElement!: HTMLDivElement;
  private readonly ANIMAL_COUNT_CHICKEN = 10;
  private readonly ANIMAL_COUNT_PIG = 6;
  private readonly ANIMAL_COUNT_DEER = 5;
  private readonly VILLAGE_ACTIVATION_RADIUS = 140;
  private readonly MAX_VILLAGERS = 75;
  private readonly REACH = 5;
  // Police-station ring/figure clicks have a slightly longer reach than block
  // mining so you can talk through the bars from just outside a cell.
  private readonly STATION_REACH = 8;

  private readonly policeStationCtx: PoliceStationContext = {
    getGroundY: (x, z) => this.worldGenerator.getHeightAt(x, z),
    countBlock: (b) => this.inventory.countBlock(b),
    consumeBlocks: (b, n) => this.inventory.consumeBlocks(b, n),
    rewardBlocks: (b, n) => { this.inventory.addBlock(b, n); },
    showMessage: (text) => this.showToast(text, 3500),
  };

  private clock: THREE.Timer;
  private keyStates: { [key: string]: boolean } = {};
  private touchForward = 0;
  private touchStrafe = 0;
  private titleElement: HTMLDivElement | null = null;
  private titleStartTime = 0;
  private debugPane!: TPane.Pane;
  private debugValues = {
    fps: 0,            // frames-in-window count (4 Hz refresh — text label)
    frameMs: 0,        // latest frametime, updated every frame — graph source
    frameMsAvg: 0,     // rolling 1 s mean (text label)
    frameMsMax: 0,     // rolling 1 s worst frame (text label)
    renderMs: 0,       // latest CPU dispatch, updated every frame — graph source
    renderMsAvg: 0,    // rolling 1 s mean (text label)
    renderMsMax: 0,    // rolling 1 s worst (text label)
    gpuRenderMs: 0,    // latest GPU render result — graph source
    gpuRenderMsAvg: 0, // rolling 1 s mean (text label)
    gpuRenderMsMax: 0, // rolling 1 s worst (text label)
    triangles: 0,
    drawCalls: 0,
    geometries: 0,
    nearChunks: 0,
    visibleNear: 0,
    farChunks: 0,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: false,
  };

  // Rolling-window stats for the three timing metrics. 1-second window per
  // the article's recommendation (https://vplesko.com/posts/how_to_implement_an_fps_counter.html).
  // The text labels (fps / *Avg / *Max) are computed from these. The graph
  // bindings plot the per-frame latest value (debugValues.frameMs etc.).
  private frameTimeStats = new FrameStats(1.0);
  private renderMsStats = new FrameStats(1.0);
  private gpuRenderMsStats = new FrameStats(1.0);
  // Display refresh rate is decoupled from sample rate: we record every
  // frame but only flush text labels 4× per second so they stay readable.
  // Tweakpane's own graph view samples its bound values on a separate
  // `interval` schedule.
  private debugPaneRefreshAt = 0;
  private static readonly DEBUG_PANE_INTERVAL_S = 0.25;

  private sfx = new Sfx(0.45);
  private skySystem!: SkySystem;
  private grassSystem!: GrassSystem;
  private grassVisible = true;
  private playerLight!: THREE.PointLight;
  private wasGrounded = true;

  private toastElement!: HTMLDivElement;
  private toastTimeoutId: number | null = null;

  // EXT_disjoint_timer_query_webgl2 state. In WebGL2 the extension only adds
  // the TIME_ELAPSED_EXT / GPU_DISJOINT_EXT enums; query objects themselves
  // use the core WebGL2 query API (gl.createQuery, beginQuery, endQuery, …).
  // Queries are pipelined: we issue one per frame and poll older ones for
  // availability on later frames. If the extension is missing this stays inert.
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pendingGpuQueries: WebGLQuery[] = [];

  private worldGenerator: WorldGenerator;
  private nearChunks: Map<string, WorldChunk> = new Map();
  private farChunks: Map<string, WorldChunk> = new Map();
  private savedVillageStates: Map<string, SavedVillage> = new Map();
  private saveIntervalId: number | null = null;
  private readonly SAVE_INTERVAL_MS = 15000;
  // More aggressive LOD: a smaller full-detail core, a 1-chunk overlap band
  // where both LODs render with dithered cross-fade (so the transition is
  // invisible), and an LOD1 horizon out to where the fog is opaque.
  // FADE_BAND_CHUNKS controls overlap thickness — fewer = sharper switch.
  // The fog ends at 180 blocks (SkySystem); 7 chunks always reaches past
  // that (≥224 blocks), and anything further is invisible anyway.
  private readonly RENDER_DISTANCE_NEAR = 3;
  private readonly RENDER_DISTANCE_FAR = 7;
  private readonly FADE_BAND_CHUNKS = 1;
  // Grass only on the chunks around the player. Radius 2 always covers at
  // least 64 blocks, past GrassSystem's blade fade-out (60 blocks).
  private readonly GRASS_RADIUS_CHUNKS = 2;
  // LOD debug state (driven by tweakpane bindings). lodForceMode=0 shows
  // both LODs normally; 1 hides LOD1 (near only); 2 hides LOD0 (far only).
  // lodDebugMode is the bit-flag uniform: 1 = no dither, 2 = visualise.
  private lodDebug = {
    forceMode: 0,
    debugMode: 0,
    fadeStart: 0,
    fadeEnd: 0,
  };
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
    // VSM gives soft, genuinely blurred shadows that don't crawl as the sun moves.
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.clock = new THREE.Timer();
    // Pauses delta accumulation while the tab is hidden so a 30s background
    // pause doesn't arrive as one giant frame step.
    this.clock.connect(document);
    const saved = SaveManager.load();
    this.worldGenerator = new WorldGenerator(saved?.seed, this.renderer);
    // Fade band — vWorldXZ in the chunk shader is post-worldRoot-scale
    // (i.e. metres), so both the camera position and these thresholds are
    // expressed in metres so the fade circle is actually centred on the
    // player. Both LODs render in [start, end]; near-only inside start,
    // far-only beyond.
    const chunkW = this.worldGenerator.getChunkSize();
    const chunkMetres = chunkW * Game.WORLD_SCALE;
    this.worldGenerator.setLodFadeRange(
      this.RENDER_DISTANCE_NEAR * chunkMetres,
      (this.RENDER_DISTANCE_NEAR + this.FADE_BAND_CHUNKS) * chunkMetres,
    );
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
    this.setupToast(container);
    this.setupGpuTimer();
    this.createTitleOverlay(container, !!saved);
    this.createReticle(container);
    this.createHint(container);
    this.createSleepUi(container);
    this.createCommandBox(container);
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
    this.titleStartTime = this.clock.getElapsed();
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

  private createSleepUi(container: HTMLElement) {
    // Bottom-of-screen prompt shown while the player stands near a bed.
    this.bedPromptElement = document.createElement('div');
    const p = this.bedPromptElement.style;
    p.position = 'absolute';
    p.bottom = '96px';
    p.left = '50%';
    p.transform = 'translateX(-50%)';
    p.padding = '6px 14px';
    p.borderRadius = '6px';
    p.background = 'rgba(0,0,0,0.66)';
    p.color = 'white';
    p.font = '600 13px/1.3 Arial, sans-serif';
    p.pointerEvents = 'none';
    p.zIndex = '7';
    p.opacity = '0';
    p.transition = 'opacity 0.15s';
    p.whiteSpace = 'nowrap';
    this.bedPromptElement.textContent = 'Click the bed to sleep';
    container.appendChild(this.bedPromptElement);

    // Full-screen fade used by the sleep transition.
    this.sleepOverlay = document.createElement('div');
    const o = this.sleepOverlay.style;
    o.position = 'absolute';
    o.inset = '0';
    o.background = '#000';
    o.opacity = '0';
    o.pointerEvents = 'none';
    o.zIndex = '40';
    container.appendChild(this.sleepOverlay);
  }

  private createCommandBox(container: HTMLElement) {
    // Bottom-of-screen prompt for typed companion commands. The keystrokes
    // don't go through a real <input> (pointer is locked); we capture them
    // ourselves and render the buffer here.
    this.commandBoxElement = document.createElement('div');
    const s = this.commandBoxElement.style;
    s.position = 'absolute';
    s.bottom = '128px';
    s.left = '50%';
    s.transform = 'translateX(-50%)';
    s.padding = '8px 14px';
    s.borderRadius = '6px';
    s.background = 'rgba(0,0,0,0.78)';
    s.color = '#cfeaff';
    s.font = '600 14px/1.3 "SF Mono", Menlo, monospace';
    s.pointerEvents = 'none';
    s.zIndex = '8';
    s.display = 'none';
    s.whiteSpace = 'nowrap';
    container.appendChild(this.commandBoxElement);
  }

  private updateTitle() {
    if (this.titleElement) {
      const elapsed = this.clock.getElapsed() - this.titleStartTime;
      if (elapsed > 2 && elapsed < 3) {
        this.titleElement.style.opacity = String(1 - (elapsed - 2));
      } else if (elapsed >= 3) {
        this.titleElement.remove();
        this.titleElement = null;
      }
    }
  }

  // Each voxel is rendered at this many metres. Chunks, grass, water,
  // animals, villagers, etc. all sit under `worldRoot` and get scaled
  // uniformly; the camera and skybox stay in the scene root so the
  // player's view ends up at the right relative height. Player-physics
  // constants in Player.ts are expressed in metres and converted to
  // voxel-space using the matching METERS_PER_VOXEL there — keep these
  // two values in sync if you change either.
  // Temporarily reverted to 1 to bisect the LOD-fade artifact: if the
  // dithering glitch goes away at 1 m blocks, the bug is in the unit
  // plumbing; if it persists, it's in the cross-fade logic. Set back to
  // 0.5 (and METERS_PER_VOXEL in Player.ts to match) to restore the
  // half-metre block experiment.
  private static readonly WORLD_SCALE = 1.0;
  private worldRoot!: THREE.Group;

  private setupScene(saved: SaveData | null) {
    this.worldRoot = new THREE.Group();
    this.worldRoot.scale.setScalar(Game.WORLD_SCALE);
    this.scene.add(this.worldRoot);

    this.skySystem = new SkySystem(this.scene, this.camera);
    if (saved?.timeOfDay !== undefined) this.skySystem.setTimeOfDay(saved.timeOfDay);
    this.grassSystem = new GrassSystem(this.worldRoot, this.worldGenerator);

    // A warm torch-like glow that activates at night and follows the player.
    this.playerLight = new THREE.PointLight(0xffcc88, 0, 14, 1.6);
    this.scene.add(this.playerLight);

    this.initializeChunks();

    let spawn: THREE.Vector3;
    if (saved?.player) {
      spawn = new THREE.Vector3(saved.player.x, saved.player.y, saved.player.z);
    } else {
      // Use the actual generated column top so we never drop into a cave that
      // intersects (0,0). If the column at the origin somehow ends up entirely
      // hollow, walk outward in +X until a solid spawn lands above sea level.
      let sx = 0, sz = 0;
      let sy = this.worldGenerator.getSurfaceY(0, 0);
      for (let attempt = 0; sy < 5 && attempt < 8; attempt++) {
        sx = (attempt + 1) * 4;
        sy = this.worldGenerator.getSurfaceY(sx, sz);
      }
      spawn = new THREE.Vector3(sx, sy, sz);
    }
    this.player = new Player(spawn);
    if (saved?.player) {
      this.player.yaw = saved.player.yaw;
      this.player.pitch = saved.player.pitch;
    }
    this.player.applyToCamera(this.camera);

    this.worldRoot.add(this.highlight.getObject());
    this.worldRoot.add(this.placementGhost.getObject());
    // Camera must be in the scene graph for its children (viewmodel) to render.
    // Stays in scene root (not worldRoot) so it doesn't get rescaled.
    this.scene.add(this.camera);
    this.camera.add(this.viewModel.getObject());

    // The player's companion spawns right next to them.
    const companionCtx: CompanionContext = {
      getPlayerPos: () => this.player.position,
      getGroundY: (x, z) => this.worldGenerator.getHeightAt(x, z),
      findTarget: (type, from) => this.findCompanionTarget(type, from),
      harvest: (type, at) => this.harvestForCompanion(type, at),
      deliver: (load) => this.deliverFromCompanion(load),
      showMessage: (text) => this.showToast(text, 2500),
    };
    const companionSpawn = new THREE.Vector3(spawn.x + 1.5, spawn.y, spawn.z);
    this.companion = new Companion(companionSpawn, companionCtx);
    this.worldRoot.add(this.companion.getGroup());
  }

  // Each handler mutates state and returns the toast message to show.
  private readonly fnKeyHandlers: Record<string, () => string> = {
    F3: () => {
      this.debugWireframe = !this.debugWireframe;
      this.worldGenerator.setWireframe(this.debugWireframe);
      return `Wireframe: ${this.debugWireframe ? 'on' : 'off'}`;
    },
    // G for fly. F5 isn't usable — Chrome and others reserve it as the
    // browser-chrome reload shortcut and ignore JS preventDefault on it.
    KeyG: () => {
      this.player.flyMode = !this.player.flyMode;
      if (this.player.flyMode) {
        // Bump up to a survey altitude so you can immediately see the
        // surrounding terrain without first hunting for the up key.
        const groundY = this.worldGenerator.getHeightAt(this.player.position.x, this.player.position.z);
        this.player.position.y = Math.max(this.player.position.y, groundY) + 18;
        this.player.velocity.set(0, 0, 0);
      }
      return `Fly: ${this.player.flyMode ? 'on (Space=up, Q=down, Shift=fast)' : 'off'}`;
    },
    F6: () => { this.resetWorld(); return 'World reset'; },
    F7: () => { this.skySystem.setTimeOfDay(0.3); return 'Time: morning'; },
    F8: () => {
      this.grassVisible = !this.grassVisible;
      this.grassSystem.setVisible(this.grassVisible);
      return `Grass: ${this.grassVisible ? 'on' : 'off'}`;
    },
  };

  private setupControls() {
    // F-keys handled in CAPTURE phase so they fire before browser-default
    // (F5 reload, F11 fullscreen, etc.) and before any DOM widget — e.g.
    // Tweakpane's graph bindings, which sometimes swallow keydown when the
    // pointer is over the debug pane. preventDefault here actually stops
    // the browser refresh.
    window.addEventListener('keydown', (event) => {
      const fnHandler = this.fnKeyHandlers[event.code];
      if (fnHandler) {
        event.preventDefault();
        event.stopPropagation();
        this.showToast(fnHandler());
      }
    }, { capture: true });

    window.addEventListener('keydown', (event) => {
      // Companion command input swallows all keystrokes until submitted/cancelled.
      if (this.commandMode) {
        event.preventDefault();
        event.stopPropagation();
        this.handleCommandKey(event);
        return;
      }
      if (event.code === 'Enter') {
        this.openCommandMode();
        event.preventDefault();
        return;
      }
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
      this.keyStates[event.code] = true;
    });

    window.addEventListener('keyup', (event) => {
      this.keyStates[event.code] = false;
    });
    // Keyup never arrives if focus leaves mid-press (alt-tab), so drop all held keys.
    const releaseAllKeys = () => { this.keyStates = {}; };
    window.addEventListener('blur', releaseAllKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAllKeys();
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
      if (this.commandMode) return;
      if (event.button === 0) {
        // A left click first tries world interactions — a police-station ring
        // or quest figure, then a house door or bed — and only mines the
        // targeted block if none of those were hit.
        if (!this.tryStationClick() && !this.tryHouseClick()) this.mineTargeted();
      } else if (event.button === 2) {
        this.placeAtTargeted();
      }
    });

    this.canvas.addEventListener('wheel', (event) => {
      if (!this.pointerLocked) return;
      this.inventory.cycle(event.deltaY > 0 ? 1 : -1);
      event.preventDefault();
    }, { passive: false });
  }

  private setupToast(container: HTMLElement) {
    const toast = document.createElement('div');
    toast.style.position = 'absolute';
    toast.style.top = '60px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '8px 16px';
    toast.style.background = 'rgba(0, 0, 0, 0.78)';
    toast.style.color = 'white';
    toast.style.font = '600 14px/1.2 Arial, sans-serif';
    toast.style.borderRadius = '6px';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
    toast.style.pointerEvents = 'none';
    toast.style.zIndex = '50';
    toast.style.whiteSpace = 'nowrap';
    container.appendChild(toast);
    this.toastElement = toast;
  }

  private showToast(message: string, durationMs = 1200) {
    this.toastElement.textContent = message;
    this.toastElement.style.opacity = '1';
    if (this.toastTimeoutId !== null) window.clearTimeout(this.toastTimeoutId);
    this.toastTimeoutId = window.setTimeout(() => {
      this.toastElement.style.opacity = '0';
      this.toastTimeoutId = null;
    }, durationMs);
  }

  // EXT_disjoint_timer_query_webgl2 gives us true GPU time for the render
  // pass, as opposed to the CPU-dispatch bracket around renderer.render().
  // Results come back a few frames late — we keep a small in-flight queue and
  // poll availability each frame. Chrome currently only exposes this when
  // chrome://flags/#enable-webgl-developer-extensions is on.
  private setupGpuTimer() {
    const gl = this.renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) return;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
      | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
      | null;
    if (!ext) return;
    this.timerExt = ext;
  }

  private pollGpuTimerQueries(nowSec: number) {
    const ext = this.timerExt;
    if (!ext) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    // GPU_DISJOINT_EXT means the driver aborted the pipeline; any in-flight
    // results are garbage — drop them and move on.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const q of this.pendingGpuQueries) gl.deleteQuery(q);
      this.pendingGpuQueries.length = 0;
      return;
    }
    while (this.pendingGpuQueries.length > 0) {
      const q = this.pendingGpuQueries[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      this.pendingGpuQueries.shift();
      const ms = ns / 1_000_000;
      // Stamp with the resolve-time `nowSec` rather than the (unknown) GPU
      // execution time. The 1-second window is wide enough that this
      // 1-2-frame stamp lag is invisible.
      this.gpuRenderMsStats.push(nowSec, ms);
      // Latest value drives the graph view; the rolling stats drive the
      // avg/worst labels.
      this.debugValues.gpuRenderMs = ms;
    }
  }

  private updateCamera() {
    this.player.applyToCamera(this.camera);
    // Camera lives in the un-scaled scene root; the world content lives
    // under a `worldRoot` scaled by WORLD_SCALE. Scale the camera position
    // here so the eye lands at the correct height relative to the
    // shrunken world. (Rotation isn't affected by scale.)
    this.camera.position.multiplyScalar(Game.WORLD_SCALE);
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
      descend: !!this.keyStates['KeyQ'],
    };
  }

  private setupDebugPane() {
    const isTouch = typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768);
    if (isTouch) return;

    this.debugPane = new TPane.Pane({ title: 'Debug', expanded: true });
    // Each metric gets a graph (Tweakpane's built-in `view: 'graph'` plotting
    // the per-frame latest value over time) plus three text labels: rolling-
    // window FPS or mean, and worst frame in the window. The graph shows
    // jitter and spikes; the text shows the precise aggregate values per
    // the article's argument that FPS must aggregate, not be instantaneous.
    this.debugPane.addBinding(this.debugValues, 'frameMs', {
      readonly: true, label: 'Frame ms', view: 'graph', min: 0, max: 50, interval: 100,
    });
    this.debugPane.addBinding(this.debugValues, 'fps', {
      readonly: true, label: 'FPS (1s)', format: (v: number) => v.toFixed(0),
    });
    this.debugPane.addBinding(this.debugValues, 'frameMsAvg', {
      readonly: true, label: '  avg', format: (v: number) => v.toFixed(2) + ' ms',
    });
    this.debugPane.addBinding(this.debugValues, 'frameMsMax', {
      readonly: true, label: '  worst', format: (v: number) => v.toFixed(2) + ' ms',
    });
    // CPU dispatch — time spent in renderer.render() queuing GL commands.
    this.debugPane.addBinding(this.debugValues, 'renderMs', {
      readonly: true, label: 'Render dispatch', view: 'graph', min: 0, max: 30, interval: 100,
    });
    this.debugPane.addBinding(this.debugValues, 'renderMsAvg', {
      readonly: true, label: '  avg', format: (v: number) => v.toFixed(2) + ' ms',
    });
    this.debugPane.addBinding(this.debugValues, 'renderMsMax', {
      readonly: true, label: '  worst', format: (v: number) => v.toFixed(2) + ' ms',
    });
    // GPU render — actual shading from EXT_disjoint_timer_query_webgl2.
    // Stays at 0 if the extension isn't exposed by the browser/driver.
    this.debugPane.addBinding(this.debugValues, 'gpuRenderMs', {
      readonly: true, label: 'GPU render', view: 'graph', min: 0, max: 30, interval: 100,
    });
    this.debugPane.addBinding(this.debugValues, 'gpuRenderMsAvg', {
      readonly: true, label: '  avg', format: (v: number) => v.toFixed(2) + ' ms',
    });
    this.debugPane.addBinding(this.debugValues, 'gpuRenderMsMax', {
      readonly: true, label: '  worst', format: (v: number) => v.toFixed(2) + ' ms',
    });
    this.debugPane.addBinding(this.debugValues, 'triangles', {
      readonly: true, label: 'Triangles', format: (v: number) => v.toLocaleString(),
    });
    this.debugPane.addBinding(this.debugValues, 'drawCalls', {
      readonly: true, label: 'Draw calls', format: (v: number) => v.toFixed(0),
    });
    this.debugPane.addBinding(this.debugValues, 'geometries', {
      readonly: true, label: 'Geometries', format: (v: number) => v.toFixed(0),
    });
    this.debugPane.addBinding(this.debugValues, 'nearChunks', {
      readonly: true, label: 'Near chunks', format: (v: number) => v.toFixed(0),
    });
    this.debugPane.addBinding(this.debugValues, 'visibleNear', {
      readonly: true, label: 'Visible near', format: (v: number) => v.toFixed(0),
    });
    this.debugPane.addBinding(this.debugValues, 'farChunks', {
      readonly: true, label: 'Far chunks (LOD1)', format: (v: number) => v.toFixed(0),
    });
    const positionFolder = this.debugPane.addFolder({ title: 'Position', expanded: false });
    positionFolder.addBinding(this.debugValues.position, 'x', { readonly: true, format: (v: number) => v.toFixed(1) });
    positionFolder.addBinding(this.debugValues.position, 'y', { readonly: true, format: (v: number) => v.toFixed(2) });
    positionFolder.addBinding(this.debugValues.position, 'z', { readonly: true, format: (v: number) => v.toFixed(1) });
    this.debugPane.addBinding(this.debugValues, 'yaw', { readonly: true, format: (v: number) => (v * 180 / Math.PI).toFixed(0) + '°' });
    this.debugPane.addBinding(this.debugValues, 'pitch', { readonly: true, format: (v: number) => (v * 180 / Math.PI).toFixed(0) + '°' });
    this.debugPane.addBinding(this.debugValues, 'grounded', { readonly: true });

    // ── LOD debug folder ─────────────────────────────────────────────────
    // Tools to diagnose the cross-fade. "Force LOD" toggles which meshes
    // render so you can see each layer alone. "Visualise fade" tints by
    // distance so you can see exactly where the fade engages in world
    // space. "Disable dither" makes LOD0 fully opaque even past the fade
    // start, so you can confirm the LOD0 mesh actually extends that far.
    const chunkW = this.worldGenerator.getChunkSize();
    this.lodDebug.fadeStart = this.RENDER_DISTANCE_NEAR * chunkW * Game.WORLD_SCALE;
    this.lodDebug.fadeEnd = (this.RENDER_DISTANCE_NEAR + this.FADE_BAND_CHUNKS) * chunkW * Game.WORLD_SCALE;
    const lodFolder = this.debugPane.addFolder({ title: 'LOD debug', expanded: false });
    lodFolder.addBinding(this.lodDebug, 'forceMode', {
      label: 'Show',
      options: { Both: 0, 'LOD0 only (near)': 1, 'LOD1 only (far)': 2 },
    }).on('change', () => this.applyLodForceMode());
    lodFolder.addBinding(this.lodDebug, 'debugMode', {
      label: 'Mode',
      options: { Normal: 0, 'No dither': 1, 'Visualise fade': 2, 'No dither + visualise': 3 },
    }).on('change', () => this.worldGenerator.setLodDebugMode(this.lodDebug.debugMode));
    lodFolder.addBinding(this.lodDebug, 'fadeStart', {
      label: 'Fade start',
      min: 0, max: 500, step: 1,
    }).on('change', () => this.worldGenerator.setLodFadeRange(this.lodDebug.fadeStart, this.lodDebug.fadeEnd));
    lodFolder.addBinding(this.lodDebug, 'fadeEnd', {
      label: 'Fade end',
      min: 0, max: 500, step: 1,
    }).on('change', () => this.worldGenerator.setLodFadeRange(this.lodDebug.fadeStart, this.lodDebug.fadeEnd));

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
        this.worldRoot.add(animal.getGroup());
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

    // Builders wait (and retry) while the player stands in the spot.
    const placeBlock = (b: PlanBlock): boolean =>
      !this.blockIntersectsPlayer(b.wx, b.wy, b.wz)
      && this.worldGenerator.placeBlock(b.wx, b.wy, b.wz, b.block);

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
      this.worldRoot.add(villager.getGroup());
    }

    // Furnish this village's houses — torches, beds, tables, doors.
    for (const house of this.worldGenerator.getHouses(v)) {
      const interior = new HouseInterior(house);
      this.houseInteriors.push(interior);
      this.worldRoot.add(interior.getGroup());
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

  private updatePoliceStations(deltaTime: number) {
    for (const st of this.policeStations) st.update(deltaTime, this.player.position);
  }

  // Mirrors village activation: once per second, spin up any police fortress
  // near the player that isn't active yet, building its furniture/prisoners.
  private updatePoliceStationSpawn(deltaTime: number) {
    this.stationSpawnAccum += deltaTime;
    if (this.stationSpawnAccum < 1) return;
    this.stationSpawnAccum = 0;
    const playerPos = this.player.position;
    const stations = this.worldGenerator.getPoliceStationsNear(
      playerPos.x, playerPos.z, this.VILLAGE_ACTIVATION_RADIUS,
    );
    for (const s of stations) {
      if (this.activatedStationKeys.has(s.key)) continue;
      this.activatedStationKeys.add(s.key);
      const cells = this.worldGenerator.getPoliceStationCells(s);
      const station = new PoliceStation(s, cells, this.policeStationCtx);
      this.policeStations.push(station);
      this.worldRoot.add(station.getGroup());
    }
  }

  // Crosshair raycast against the active stations' clickable objects (red
  // ring, then quest figure). Returns true if a click was handled — Game then
  // skips the mining action for this click.
  private tryStationClick(): boolean {
    if (this.policeStations.length === 0) return false;
    this.clickRaycaster.set(this.player.eye, this.player.forward);
    this.clickRaycaster.far = this.STATION_REACH;
    let bestDist = Infinity;
    let bestStation: PoliceStation | null = null;
    let bestObj: THREE.Object3D | null = null;
    for (const st of this.policeStations) {
      const targets = st.getClickables();
      if (targets.length === 0) continue;
      const hits = this.clickRaycaster.intersectObjects(targets, true);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        bestDist = hits[0].distance;
        bestStation = st;
        bestObj = hits[0].object;
      }
    }
    if (bestStation && bestObj) {
      bestStation.handleClick(bestObj);
      return true;
    }
    return false;
  }

  // Drives house torches off the day/night cycle and shows the "sleep"
  // prompt whenever the player is standing next to a bed.
  private updateHouseInteriors(deltaTime: number) {
    const nightFactor = this.skySystem.getNightFactor();
    const playerPos = this.player.position;
    let nearBed = false;
    for (const h of this.houseInteriors) {
      h.update(deltaTime, nightFactor);
      const b = h.getBedPosition();
      if (Math.hypot(b.x - playerPos.x, b.z - playerPos.z) < 2.6) nearBed = true;
    }
    this.bedPromptElement.style.opacity = nearBed && !this.sleeping ? '1' : '0';
  }

  // Crosshair raycast against house doors and beds. Doors toggle in place;
  // a bed click starts the sleep transition. Returns true if handled.
  private tryHouseClick(): boolean {
    if (this.houseInteriors.length === 0) return false;
    this.clickRaycaster.set(this.player.eye, this.player.forward);
    this.clickRaycaster.far = this.STATION_REACH;
    let bestDist = Infinity;
    let bestHouse: HouseInterior | null = null;
    let bestObj: THREE.Object3D | null = null;
    for (const h of this.houseInteriors) {
      const hits = this.clickRaycaster.intersectObjects(h.getClickables(), true);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        bestDist = hits[0].distance;
        bestHouse = h;
        bestObj = hits[0].object;
      }
    }
    if (!bestHouse || !bestObj) return false;
    // Require line of sight: if a solid block sits between the player and the
    // door/bed, this was really an attempt to mine that block.
    if (this.worldGenerator.raycastBlock(this.player.eye, this.player.forward, bestDist - 0.05)) {
      return false;
    }
    const action = bestHouse.handleClick(bestObj);
    if (action === 'sleep') this.startSleep(bestHouse.getBedPosition());
    return action !== null;
  }

  // Sleep transition: the player lies down on the bed (camera drops to the
  // mattress and looks up), the screen fades through black while the clock
  // jumps to morning, then the player gets back up where they stood.
  private startSleep(bedPos: THREE.Vector3) {
    if (this.sleeping) return;
    this.sleeping = true;
    this.bedPromptElement.style.opacity = '0';
    this.sfx.play('pickup');

    // Head resting near the pillow end, eye just above the mattress, facing up.
    const lyingPos = new THREE.Vector3(bedPos.x - 0.45, bedPos.y + 0.62, bedPos.z);
    const lyingPitch = 1.25;
    // Standing pose to return to — exactly where the player was when they clicked.
    const standPos = this.player.eye.clone();
    const standPitch = this.player.pitch;
    const standYaw = this.player.yaw;

    this.camera.rotation.order = 'YXZ';

    gsap.timeline({ onComplete: () => { this.sleeping = false; } })
      // Lie down onto the bed.
      .to(this.camera.position, {
        x: lyingPos.x, y: lyingPos.y, z: lyingPos.z, duration: 0.45, ease: 'power2.inOut',
      }, 0)
      .to(this.camera.rotation, { x: lyingPitch, duration: 0.45, ease: 'power2.inOut' }, 0)
      // Fade through black, jump the clock to morning (auto-extinguishes torches).
      .to(this.sleepOverlay, { opacity: 1, duration: 0.5, ease: 'power2.in' })
      .add(() => { this.skySystem.setTimeOfDay(0.28); })
      .to(this.sleepOverlay, { opacity: 0, duration: 0.7, ease: 'power2.out' }, '+=0.35')
      // Get back up.
      .to(this.camera.position, {
        x: standPos.x, y: standPos.y, z: standPos.z, duration: 0.4, ease: 'power2.inOut',
      })
      .to(this.camera.rotation, { x: standPitch, y: standYaw, duration: 0.4, ease: 'power2.inOut' }, '<');
  }

  // --- Companion command input (a=meat, b=wood, c=stone) ---

  private openCommandMode(): void {
    this.commandMode = true;
    this.commandBuffer = '';
    // Drop any held movement keys so the player doesn't keep walking.
    this.keyStates = {};
    this.commandBoxElement.style.display = 'block';
    this.refreshCommandBox();
  }

  private closeCommandMode(): void {
    this.commandMode = false;
    this.commandBuffer = '';
    this.commandBoxElement.style.display = 'none';
  }

  private refreshCommandBox(): void {
    this.commandBoxElement.textContent =
      `> ${this.commandBuffer}_   (a=meat  b=wood  c=stone)`;
  }

  private handleCommandKey(event: KeyboardEvent): void {
    if (event.code === 'Escape') { this.closeCommandMode(); return; }
    if (event.code === 'Enter') { this.submitCommand(); return; }
    if (event.code === 'Backspace') {
      this.commandBuffer = this.commandBuffer.slice(0, -1);
      this.refreshCommandBox();
      return;
    }
    // event.key holds the typed character; only accept printables.
    if (event.key.length === 1 && this.commandBuffer.length < 12) {
      this.commandBuffer += event.key.toLowerCase();
      this.refreshCommandBox();
    }
  }

  private submitCommand(): void {
    const raw = this.commandBuffer.trim().toLowerCase();
    this.closeCommandMode();
    if (!raw) return;
    const ch = raw[0];
    const type: GatherType | null =
      ch === 'a' ? 'meat' : ch === 'b' ? 'wood' : ch === 'c' ? 'stone' : null;
    if (!type) {
      this.showToast(`Unknown command: ${raw}`, 1800);
      return;
    }
    if (this.companion) this.companion.command(type);
  }

  // --- Companion context implementation (findTarget / harvest / deliver) ---

  private findCompanionTarget(type: GatherType, from: THREE.Vector3): THREE.Vector3 | null {
    if (type === 'meat') {
      let best: THREE.Vector3 | null = null;
      let bestDist = 50;
      for (const a of this.animals) {
        if (!a.isAlive()) continue;
        const p = a.getPosition();
        const d = Math.hypot(p.x - from.x, p.z - from.z);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      return best ? new THREE.Vector3(best.x, best.y, best.z) : null;
    }
    if (type === 'wood') {
      // Ring scan outward for a tree trunk WOOD block on the surface.
      const cx = Math.floor(from.x);
      const cz = Math.floor(from.z);
      for (let r = 1; r <= 28; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const wx = cx + dx;
            const wz = cz + dz;
            const gy = this.worldGenerator.getHeightAt(wx, wz);
            if (gy <= 0) continue;
            if (this.isTreeTrunk(wx, gy, wz)) {
              return new THREE.Vector3(wx + 0.5, gy, wz + 0.5);
            }
          }
        }
      }
      return null;
    }
    // stone: dig a hole a few blocks away from the companion.
    const sx = from.x + 5;
    const sz = from.z;
    const gy = this.worldGenerator.getHeightAt(sx, sz);
    return new THREE.Vector3(sx, gy, sz);
  }

  // A tree is a WOOD column capped by LEAVES. House walls are also WOOD but
  // end in ROOF (or air), so this keeps the companion from chopping houses.
  private isTreeTrunk(wx: number, baseY: number, wz: number): boolean {
    if (this.worldGenerator.getBlock(wx, baseY, wz) !== WOOD) return false;
    let y = baseY + 1;
    while (y < baseY + 8 && this.worldGenerator.getBlock(wx, y, wz) === WOOD) y++;
    return this.worldGenerator.getBlock(wx, y, wz) === LEAVES;
  }

  private harvestForCompanion(type: GatherType, at: THREE.Vector3): CarryLoad | null {
    if (type === 'meat') {
      let nearest: Animal | null = null;
      let bestDist = 8;
      for (const a of this.animals) {
        if (!a.isAlive()) continue;
        const p = a.getPosition();
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        if (d < bestDist) { bestDist = d; nearest = a; }
      }
      if (!nearest) return null;
      nearest.destroy();
      return { kind: 'meat', count: 1 };
    }
    if (type === 'wood') {
      // Chop up to 6 WOOD blocks in the column starting at `at.y`.
      const wx = Math.floor(at.x);
      const wz = Math.floor(at.z);
      const startY = Math.floor(at.y);
      let count = 0;
      for (let y = startY; y < startY + 8 && count < 6; y++) {
        if (this.worldGenerator.getBlock(wx, y, wz) === WOOD) {
          this.worldGenerator.placeBlock(wx, y, wz, AIR);
          count++;
        } else if (count > 0) {
          break;
        }
      }
      return count === 0 ? null : { kind: 'blocks', entries: [[WOOD, count]] };
    }
    // stone: dig down through the surface, collecting whatever lies below.
    const wx = Math.floor(at.x);
    const wz = Math.floor(at.z);
    const gy = this.worldGenerator.getHeightAt(wx, wz);
    const tally = new Map<BlockId, number>();
    for (let y = gy - 1; y >= Math.max(1, gy - 8); y--) {
      const b = this.worldGenerator.getBlock(wx, y, wz);
      if (b !== DIRT && b !== STONE && b !== GRASS && b !== SAND
        && b !== COAL_ORE && b !== IRON_ORE && b !== GOLD_ORE) continue;
      this.worldGenerator.placeBlock(wx, y, wz, AIR);
      tally.set(b, (tally.get(b) ?? 0) + 1);
    }
    if (tally.size === 0) return null;
    return { kind: 'blocks', entries: [...tally] };
  }

  private deliverFromCompanion(load: CarryLoad): string {
    if (load.kind === 'meat') {
      this.inventory.addFood(load.count);
      return `Companion: +${load.count} Meat`;
    }
    const parts: string[] = [];
    for (const [block, count] of load.entries) {
      if (count <= 0) continue;
      this.inventory.addBlock(block, count);
      parts.push(`+${count} ${blockLabel(block)}`);
    }
    return parts.length > 0 ? `Companion: ${parts.join(', ')}` : `Companion: nothing to deliver.`;
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
    this.worldRoot.add(chunk.mesh);
    if (this.lodDebug.forceMode === 2) chunk.mesh.visible = false;
  }

  private unloadNearChunk(key: string) {
    const chunk = this.nearChunks.get(key);
    if (!chunk) return;
    this.worldRoot.remove(chunk.mesh);
    this.nearChunks.delete(key);
    const [cx, cz] = key.split(',').map(Number);
    this.worldGenerator.disposeChunkFull(cx, cz);
  }

  private loadFarChunk(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ);
    if (this.farChunks.has(key)) return;
    const chunk = this.worldGenerator.generateChunkLOD1(chunkX, chunkZ);
    this.farChunks.set(key, chunk);
    this.worldRoot.add(chunk.mesh);
    if (this.lodDebug.forceMode === 1) chunk.mesh.visible = false;
  }

  private unloadFarChunk(key: string) {
    const chunk = this.farChunks.get(key);
    if (!chunk) return;
    this.worldRoot.remove(chunk.mesh);
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
    const fadeBand = this.FADE_BAND_CHUNKS;
    // Bands (Chebyshev chunk distance):
    //   [0 .. nearR-1]      → only near loaded
    //   [nearR-1 .. nearOuter+1]  → BOTH loaded (overlap, where the dither
    //       fade engages). One chunk of slack on each side of the fade band
    //       so fragments at chunk-distance boundaries always have both
    //       LODs available — without this, the player walking to the edge
    //       of their chunk shifts voxel distances enough that a fading
    //       fragment can land in a chunk that only has one LOD loaded,
    //       producing holes in the world.
    //   (nearOuter+1 .. farR]      → only far loaded
    const nearOuter = nearR + fadeBand;
    const overlapInner = nearR;       // load far at this chunk-dist too
    const overlapOuter = nearOuter;   // (already inclusive of fadeBand)

    for (let dx = -farR; dx <= farR; dx++) {
      for (let dz = -farR; dz <= farR; dz++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dz));
        if (dist > farR) continue;
        const cx = currentChunkX + dx;
        const cz = currentChunkZ + dz;
        const key = this.getChunkKey(cx, cz);
        if (dist <= overlapOuter) wantedNear.add(key);
        if (dist >= overlapInner) wantedFar.add(key);
      }
    }

    // Unload near chunks that no longer belong (outside the near+fade zone).
    for (const key of [...this.nearChunks.keys()]) {
      if (!wantedNear.has(key)) this.unloadNearChunk(key);
    }
    // Unload far chunks that are out of range. (Far chunks may legitimately
    // coexist with near in the overlap band, so we no longer drop them just
    // because a near chunk is loaded at the same key.)
    for (const key of [...this.farChunks.keys()]) {
      if (!wantedFar.has(key)) this.unloadFarChunk(key);
    }

    // Throttled loading: cap how many chunks we generate + mesh per frame
    // and prioritise the closest ones. Without this, crossing a chunk
    // boundary triggers a sync load of every missing chunk in one frame
    // (~5-15 LOD0 + ~30 LOD1 chunks worst case), which blocks the render
    // loop for hundreds of ms. Loading a couple per frame turns that into
    // a barely-perceptible "ring drawn in" over the next ~½ second.
    const loadList = (
      wanted: Set<string>,
      have: Map<string, unknown>,
    ): Array<[string, number]> => {
      const out: Array<[string, number]> = [];
      for (const key of wanted) {
        if (have.has(key)) continue;
        const [cx, cz] = key.split(',').map(Number);
        const dist = Math.max(Math.abs(cx - currentChunkX), Math.abs(cz - currentChunkZ));
        out.push([key, dist]);
      }
      out.sort((a, b) => a[1] - b[1]);
      return out;
    };

    const NEAR_BUDGET = 2;  // heavy: full-detail mesh + voxel gen
    const FAR_BUDGET = 4;   // lighter: half-res mesh, often shares voxel data with near
    const missingNear = loadList(wantedNear, this.nearChunks);
    for (let i = 0; i < Math.min(NEAR_BUDGET, missingNear.length); i++) {
      const [cx, cz] = missingNear[i][0].split(',').map(Number);
      this.loadNearChunk(cx, cz);
    }
    const missingFar = loadList(wantedFar, this.farChunks);
    for (let i = 0; i < Math.min(FAR_BUDGET, missingFar.length); i++) {
      const [cx, cz] = missingFar[i][0].split(',').map(Number);
      this.loadFarChunk(cx, cz);
    }

    this.syncGrass(currentChunkX, currentChunkZ);
  }

  // Grass follows a small square around the player, independent of the
  // near ring. Blades fade out before the square's edge, so chunks entering
  // or leaving it never pop.
  private syncGrass(currentChunkX: number, currentChunkZ: number) {
    if (!this.grassSystem) return;
    const r = this.GRASS_RADIUS_CHUNKS;
    const inRange = (cx: number, cz: number) =>
      Math.max(Math.abs(cx - currentChunkX), Math.abs(cz - currentChunkZ)) <= r;

    for (const [cx, cz] of this.grassSystem.getChunks()) {
      if (!inRange(cx, cz)) this.grassSystem.removeChunk(cx, cz);
    }
    // Building grass scans a whole chunk, so do one per frame, closest first.
    let best: [number, number] | null = null;
    let bestDist = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cx = currentChunkX + dx;
        const cz = currentChunkZ + dz;
        if (this.grassSystem.hasChunk(cx, cz)) continue;
        if (!this.nearChunks.has(this.getChunkKey(cx, cz))) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dz));
        if (dist < bestDist) { bestDist = dist; best = [cx, cz]; }
      }
    }
    if (best) this.grassSystem.addChunk(best[0], best[1]);
  }

  private getChunkKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  // Drive the "Show: LOD0 only / LOD1 only / Both" radio in the LOD debug
  // folder. Toggles `mesh.visible` on the existing chunks; loadNearChunk /
  // loadFarChunk also call this for newly-streamed chunks so the override
  // sticks as you walk around.
  private applyLodForceMode(): void {
    const mode = this.lodDebug.forceMode;
    const showNear = mode === 0 || mode === 1;
    const showFar = mode === 0 || mode === 2;
    for (const c of this.nearChunks.values()) c.mesh.visible = showNear;
    for (const c of this.farChunks.values()) c.mesh.visible = showFar;
  }

  // Face indices match VoxelChunk: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z
  // Only +/-X and +/-Z move to a loaded neighbor chunk (we don't stack
  // chunks vertically). +/-Y still participate as entry/exit faces in the
  // seed chunk's 6-bit entry mask.
  private static readonly FACE_DX = [1, -1, 0, 0, 0, 0];
  private static readonly FACE_DZ = [0, 0, 0, 0, 1, -1];
  private static readonly FACE_OPPOSITE = [1, 0, 3, 2, 5, 4];
  private static readonly HORIZONTAL_FACES = [0, 1, 4, 5];

  private updateVisibilityCulling() {
    const chunkSize = this.worldGenerator.getChunkSize();
    const playerCx = Math.floor(this.player.position.x / chunkSize);
    const playerCz = Math.floor(this.player.position.z / chunkSize);
    const seedKey = this.getChunkKey(playerCx, playerCz);

    const entryFaces = new Map<string, number>();
    const queue: Array<{ cx: number; cz: number; faces: number }> = [];

    if (!this.nearChunks.has(seedKey)) {
      // Player is standing on an unloaded chunk (edge case). Show everything.
      for (const wc of this.nearChunks.values()) wc.mesh.visible = true;
      this.debugValues.visibleNear = this.nearChunks.size;
      return;
    }

    // Seed: we're inside the player's chunk, so all 6 faces count as entry.
    entryFaces.set(seedKey, 0b111111);
    queue.push({ cx: playerCx, cz: playerCz, faces: 0b111111 });

    while (queue.length > 0) {
      const { cx, cz, faces } = queue.shift()!;
      const conn = this.worldGenerator.getChunkConnectivity(cx, cz);
      if (!conn) continue;

      for (const exitFace of Game.HORIZONTAL_FACES) {
        // Can we reach this outgoing face from any of the entry faces?
        let reachable = false;
        for (let inFace = 0; inFace < 6; inFace++) {
          if ((faces & (1 << inFace)) === 0) continue;
          if ((conn[inFace] & (1 << exitFace)) !== 0) { reachable = true; break; }
        }
        if (!reachable) continue;

        const ncx = cx + Game.FACE_DX[exitFace];
        const ncz = cz + Game.FACE_DZ[exitFace];
        const nKey = this.getChunkKey(ncx, ncz);
        if (!this.nearChunks.has(nKey)) continue;

        const newEntry = 1 << Game.FACE_OPPOSITE[exitFace];
        const prev = entryFaces.get(nKey) ?? 0;
        const merged = prev | newEntry;
        if (merged === prev) continue;
        entryFaces.set(nKey, merged);
        queue.push({ cx: ncx, cz: ncz, faces: merged });
      }
    }

    // Apply visibility. Far-ring chunks are never culled here — they stay on
    // Three.js's default frustum culling.
    let visibleCount = 0;
    for (const [key, wc] of this.nearChunks) {
      const visible = entryFaces.has(key);
      wc.mesh.visible = visible;
      if (visible) visibleCount++;
    }
    this.debugValues.visibleNear = visibleCount;
  }

  private animationStarted = false;
  private debugWireframe = false;

  public animate() {
    this.clock.update();
    // Discard the first delta (it spans construction → first frame).
    const wasFirstFrame = !this.animationStarted;
    this.animationStarted = true;
    const deltaTime = wasFirstFrame ? 0 : Math.min(this.clock.getDelta(), 0.05);

    this.updateTitle();

    // While sleeping the player is frozen and the camera pose is driven by
    // the sleep tween instead of the normal eye sync.
    if (!this.sleeping) {
      // Below y=0 counts as solid so the player can never fall out of the world.
      this.player.update(deltaTime, this.gatherInput(),
        (wx, wy, wz) => wy < 0 || this.worldGenerator.getBlock(wx, wy, wz) !== AIR);

      if (this.player.didJump) this.sfx.play('jump');
      this.wasGrounded = this.player.grounded;

      this.updateCamera();
    }
    this.skySystem.advance(deltaTime);
    this.skySystem.updateForCamera(this.camera);
    this.grassSystem.update(deltaTime);
    this.grassSystem.setSunDir(this.skySystem.getDirectionalLight().position);
    this.worldGenerator.advanceTime(deltaTime);
    // Camera XZ goes to the chunk shader's fade calculation. The shader's
    // vWorldXZ is post-worldRoot-scale (metres), so we pass the player
    // position in the same scaled space.
    this.worldGenerator.setCameraXZ(
      this.player.eye.x * Game.WORLD_SCALE,
      this.player.eye.z * Game.WORLD_SCALE,
    );
    this.playerLight.position.copy(this.player.eye).multiplyScalar(Game.WORLD_SCALE);
    // Headlamp turns on at night AND when the player is in a cave (sky-access
    // at the eye cell drops from 2 → 0). Both contributions stack so it gets
    // brighter at night underground than in daytime caves.
    const eye = this.player.eye;
    const skyHere = this.worldGenerator.getSkyOpenAt(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const caveFactor = skyHere === 0 ? 1.0 : skyHere === 1 ? 0.4 : 0.0;
    this.playerLight.intensity = this.skySystem.getNightFactor() * 1.6 + caveFactor * 1.4;
    this.updateChunks();
    this.updateVisibilityCulling();
    this.updateTargeted();

    this.updateAnimals(deltaTime);
    this.updateVillagers(deltaTime);
    this.updateVillagerSpawn(deltaTime);
    this.updatePoliceStations(deltaTime);
    this.updatePoliceStationSpawn(deltaTime);
    this.updateHouseInteriors(deltaTime);
    this.companion?.update(deltaTime);

    this.drawMinimap();
    this.updateEconomyHud();
    this.inventoryHud.render();
    this.syncViewModel();
    this.updateHint();

    // Sample frametime into the rolling-window stat. The graph view
    // samples `debugValues.frameMs` on its own `interval` schedule.
    const nowSec = performance.now() / 1000;
    const frameMs = deltaTime * 1000;
    this.frameTimeStats.push(nowSec, frameMs);
    this.debugValues.frameMs = frameMs;

    this.debugValues.position.x = this.player.position.x;
    this.debugValues.position.y = this.player.position.y;
    this.debugValues.position.z = this.player.position.z;
    this.debugValues.yaw = this.player.yaw;
    this.debugValues.pitch = this.player.pitch;
    this.debugValues.grounded = this.player.grounded;
    this.debugValues.nearChunks = this.nearChunks.size;
    this.debugValues.farChunks = this.farChunks.size;

    const renderStart = performance.now();
    const ext = this.timerExt;
    const gl = ext ? (this.renderer.getContext() as WebGL2RenderingContext) : null;
    const query = gl ? gl.createQuery() : null;
    if (ext && gl && query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.renderer.render(this.scene, this.camera);
    if (ext && gl && query) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.pendingGpuQueries.push(query);
    }
    const renderMs = performance.now() - renderStart;
    this.renderMsStats.push(nowSec, renderMs);
    this.debugValues.renderMs = renderMs;
    this.pollGpuTimerQueries(nowSec);
    this.debugValues.triangles = this.renderer.info.render.triangles;
    this.debugValues.drawCalls = this.renderer.info.render.calls;
    this.debugValues.geometries = this.renderer.info.memory.geometries;

    // Refresh the rolling-window text labels at 4 Hz. Article: "The
    // frequency at which you update the display does not need to correspond
    // to rolling window's length." Sampling stays at full frame rate; only
    // the readout cadence is throttled. The graph view above samples the
    // per-frame `*Ms` values on its own internal interval.
    if (nowSec - this.debugPaneRefreshAt >= Game.DEBUG_PANE_INTERVAL_S) {
      this.debugPaneRefreshAt = nowSec;
      this.debugValues.fps = this.frameTimeStats.fps();
      this.debugValues.frameMsAvg = this.frameTimeStats.mean();
      this.debugValues.frameMsMax = this.frameTimeStats.max();
      this.debugValues.renderMsAvg = this.renderMsStats.mean();
      this.debugValues.renderMsMax = this.renderMsStats.max();
      this.debugValues.gpuRenderMsAvg = this.gpuRenderMsStats.mean();
      this.debugValues.gpuRenderMsMax = this.gpuRenderMsStats.max();
    }
    requestAnimationFrame(() => this.animate());
  }

  private updateAnimals(deltaTime: number) {
    const playerPos = this.player.position;
    const getGroundY = (x: number, z: number) => this.worldGenerator.getHeightAt(x, z);

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      a.update(deltaTime, playerPos, getGroundY);

      if (!a.isAlive()) {
        this.worldRoot.remove(a.getGroup());
        this.animals.splice(i, 1);
        const spawn = randomPointAround(playerPos, 40, 90);
        spawn.y = getGroundY(spawn.x, spawn.z);
        const factory = a.kind === 'chicken' ? createChicken : a.kind === 'pig' ? createPig : createDeer;
        const replacement = factory(spawn);
        this.animals.push(replacement);
        this.worldRoot.add(replacement.getGroup());
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

  private invalidateGrassAround(wx: number, wz: number) {
    const chunkSize = this.worldGenerator.getChunkSize();
    const cx = Math.floor(wx / chunkSize);
    const cz = Math.floor(wz / chunkSize);
    if (this.grassSystem.hasChunk(cx, cz)) this.grassSystem.rebuildChunk(cx, cz);
  }

  private syncViewModel() {
    const selected = this.inventory.getSelected();
    if (!selected) { this.viewModel.setKind('none'); return; }
    if (selected.item.kind === 'tool') {
      this.viewModel.setKind(selected.item.tool);
    } else if (selected.item.kind === 'food') {
      this.viewModel.setKind('none');
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
    // Bedrock floor: y=0 is unbreakable so the player can't dig out the
    // bottom of the world. No SFX or inventory update either — the click
    // silently no-ops, mirroring how Minecraft handles bedrock.
    if (wy === 0) return;
    if (!this.inventory.canAddBlock(block)) { this.flashHint('Inventory full'); return; }
    const ok = this.worldGenerator.placeBlock(wx, wy, wz, AIR);
    if (!ok) return;
    this.inventory.addBlock(block, 1);
    this.sfx.play('mine');
    this.viewModel.swing();
    this.invalidateGrassAround(wx, wz);
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
    this.worldRoot.add(mesh);

    const to = new THREE.Vector3(wx + 0.5, wy + 0.5, wz + 0.5);
    const distance = from.distanceTo(to);
    // Apex height scales with throw distance so a close toss doesn't loop up too far.
    const apex = Math.max(from.y, to.y) + Math.min(1.6, 0.45 + distance * 0.22);
    const duration = 0.18 + Math.min(0.25, distance * 0.04);
    const riseTime = duration * 0.45;
    const fallTime = duration - riseTime;

    const finalize = () => {
      const stillAir = this.worldGenerator.getBlock(wx, wy, wz) === AIR;
      if (stillAir && !this.blockIntersectsPlayer(wx, wy, wz)) {
        this.worldGenerator.placeBlock(wx, wy, wz, block);
        this.invalidateGrassAround(wx, wz);
      } else {
        // Target got filled (e.g. by a villager) or the player walked into it; give the block back.
        this.inventory.addBlock(block, 1);
      }
      this.worldRoot.remove(mesh);
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
    if (this.blockIntersectsPlayer(b.wx, b.wy, b.wz)) { this.flashHint('Step out of the way'); return; }
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
      timeOfDay: this.skySystem.getTimeOfDay(),
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
