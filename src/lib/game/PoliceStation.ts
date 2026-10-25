import * as THREE from 'three';
import { Prisoner, type PrisonerPose } from './Prisoner';
import { blockLabel } from './Inventory';
import { COAL_ORE, GOLD_ORE, SAND, STONE, WOOD, type BlockId } from './voxel/BlockTypes';
import type { PoliceStationCell, PoliceStationData } from './WorldGenerator';

// One activated police fortress: furnished jail cells, ambient prisoners, and
// a single quest cell marked with a clickable red ring. Clicking the ring
// makes a prisoner appear; clicking the prisoner makes it step up to the bars
// and ask the player to fetch a material in exchange for a reward.

export interface PoliceStationContext {
  getGroundY: (x: number, z: number) => number;
  countBlock: (block: BlockId) => number;
  consumeBlocks: (block: BlockId, count: number) => boolean;
  rewardBlocks: (block: BlockId, count: number) => void;
  showMessage: (text: string) => void;
}

type QuestState = 'figure-absent' | 'figure-present' | 'approaching' | 'active' | 'done';

// Materials the player can realistically gather and bring back.
const QUEST_BLOCKS: BlockId[] = [STONE, WOOD, SAND, COAL_ORE];

// Small deterministic hash so every player sees the same quest at a station.
function hash01(seed: number, salt: number): number {
  let h = Math.imul((seed | 0) ^ salt, 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 0xffffffff;
}

interface CellSpots {
  bed: THREE.Vector3;
  toilet: THREE.Vector3;
  sink: THREE.Vector3;
  stand: THREE.Vector3;
  sit: THREE.Vector3;
  spawn: THREE.Vector3;
  marker: THREE.Vector3;
}

export class PoliceStation {
  private readonly group = new THREE.Group();
  private readonly ctx: PoliceStationContext;
  private readonly prisoners: Prisoner[] = [];

  private marker: THREE.Mesh | null = null;
  private markerTime = 0;
  private questGiver: Prisoner | null = null;
  private questGiverBarsSpot: THREE.Vector3 | null = null;
  private questGiverSpawn = new THREE.Vector3();

  private questState: QuestState = 'figure-absent';
  private readonly questBlock: BlockId;
  private readonly questCount: number;
  private readonly rewardBlock: BlockId = GOLD_ORE;
  private readonly rewardCount: number;

  constructor(station: PoliceStationData, cells: PoliceStationCell[], ctx: PoliceStationContext) {
    this.ctx = ctx;

    this.questBlock = QUEST_BLOCKS[Math.floor(hash01(station.seed, 0x11) * QUEST_BLOCKS.length)];
    this.questCount = 4 + Math.floor(hash01(station.seed, 0x22) * 5);  // 4..8
    this.rewardCount = 6 + Math.floor(hash01(station.seed, 0x33) * 5); // 6..10

    for (const cell of cells) {
      const spots = this.cellSpots(cell);
      this.buildFurniture(spots);

      if (cell.isQuest) {
        this.marker = this.buildMarker(spots.marker);
        this.group.add(this.marker);
        // Remember where the quest giver should spawn and where it walks to.
        this.questGiverSpawn = spots.spawn;
        this.questGiverBarsSpot = spots.stand;
      } else {
        const pose: PrisonerPose = hash01(station.seed, 0x40 + cell.index) < 0.5 ? 'stand' : 'sit';
        const pos = pose === 'sit' ? spots.sit : spots.stand;
        const prisoner = new Prisoner(pos, 0, pose); // facing 0 = +Z = looking out at the courtyard
        this.prisoners.push(prisoner);
        this.group.add(prisoner.getGroup());
      }
    }
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

  // Objects the crosshair raycast should test against: the red ring while it
  // exists, then the quest giver once spawned.
  public getClickables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    if (this.marker) list.push(this.marker);
    if (this.questGiver) list.push(this.questGiver.getGroup());
    return list;
  }

  public handleClick(hit: THREE.Object3D): void {
    let o: THREE.Object3D | null = hit;
    let kind: string | undefined;
    while (o) {
      if (o.userData.psKind) { kind = o.userData.psKind as string; break; }
      o = o.parent;
    }
    if (kind === 'marker') this.onMarkerClick();
    else if (kind === 'questGiver') this.onQuestGiverClick();
  }

  public update(deltaTime: number, playerPos: THREE.Vector3): void {
    const getGroundY = this.ctx.getGroundY;
    for (const p of this.prisoners) p.update(deltaTime, getGroundY);

    if (this.questGiver) {
      // Face the player whenever it isn't busy walking up to the bars.
      if (this.questState !== 'approaching') {
        const gp = this.questGiver.getPosition();
        this.questGiver.setFacing(Math.atan2(playerPos.x - gp.x, playerPos.z - gp.z));
      }
      this.questGiver.update(deltaTime, getGroundY);

      if (this.questState === 'approaching' && this.questGiver.hasArrived()) {
        this.questState = 'active';
        this.ctx.showMessage(
          `Prisoner: Bring me ${this.questCount}x ${blockLabel(this.questBlock)} and I'll reward you!`,
        );
      }
    }

    if (this.marker) {
      this.markerTime += deltaTime;
      const pulse = 1 + Math.sin(this.markerTime * 3.2) * 0.12;
      this.marker.scale.setScalar(pulse);
      this.marker.rotation.z += deltaTime * 1.4;
    }
  }

  private onMarkerClick(): void {
    if (this.marker) {
      this.group.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
      this.marker = null;
    }
    this.questGiver = new Prisoner(this.questGiverSpawn, 0, 'stand');
    this.questGiver.getGroup().userData.psKind = 'questGiver';
    this.group.add(this.questGiver.getGroup());
    this.questState = 'figure-present';
    this.ctx.showMessage('A prisoner appears in the cell. Talk to them.');
  }

  private onQuestGiverClick(): void {
    switch (this.questState) {
      case 'figure-present':
        if (this.questGiverBarsSpot) this.questGiver!.walkTo(this.questGiverBarsSpot);
        this.questState = 'approaching';
        break;

      case 'approaching':
        // Still walking up — the quest line shows on arrival.
        break;

      case 'active': {
        const have = this.ctx.countBlock(this.questBlock);
        if (have >= this.questCount && this.ctx.consumeBlocks(this.questBlock, this.questCount)) {
          this.ctx.rewardBlocks(this.rewardBlock, this.rewardCount);
          this.questState = 'done';
          this.ctx.showMessage(
            `Prisoner: Thank you! Here's ${this.rewardCount}x ${blockLabel(this.rewardBlock)}.`,
          );
        } else {
          this.ctx.showMessage(
            `Prisoner: I need ${this.questCount}x ${blockLabel(this.questBlock)} — you have ${have}.`,
          );
        }
        break;
      }

      case 'done':
        this.ctx.showMessage('Prisoner: Thanks again, friend.');
        break;
    }
  }

  // World-space anchor points for one cell. cell.x/zMin..Max are interior
  // voxel indices; the bars sit at zMax+1, the courtyard beyond zMax+2.
  private cellSpots(cell: PoliceStationCell): CellSpots {
    const wx0 = cell.xMin;            // left interior edge (world units)
    const cx = cell.xMin + 1.5;       // interior centre (3 columns wide)
    const fy = cell.floorY;
    return {
      bed: new THREE.Vector3(wx0 + 0.95, fy, cell.zMin + 0.6),
      toilet: new THREE.Vector3(wx0 + 2.55, fy, cell.zMin + 0.55),
      sink: new THREE.Vector3(wx0 + 2.62, fy, cell.zMax + 0.55),
      stand: new THREE.Vector3(wx0 + 0.9, fy, cell.zMax + 0.7),
      sit: new THREE.Vector3(wx0 + 0.95, fy, cell.zMin + 0.85),
      spawn: new THREE.Vector3(cx, fy, cell.zMin + 0.6),
      marker: new THREE.Vector3(cx, fy + 1.5, cell.zMax + 2.1),
    };
  }

  private buildFurniture(spots: CellSpots): void {
    this.group.add(this.buildBed(spots.bed));
    this.group.add(this.buildToilet(spots.toilet));
    this.group.add(this.buildSink(spots.sink));
  }

  private box(
    sx: number, sy: number, sz: number,
    x: number, y: number, z: number,
    color: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshLambertMaterial({ color }),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  }

  private buildBed(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.add(this.box(1.8, 0.26, 0.85, 0, 0.16, 0, 0x5a3a1c));   // frame
    g.add(this.box(1.7, 0.16, 0.74, 0, 0.36, 0, 0x8a96a8));   // mattress
    g.add(this.box(0.42, 0.14, 0.66, -0.62, 0.5, 0, 0xdfe3e8)); // pillow
    return g;
  }

  private buildToilet(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.add(this.box(0.46, 0.42, 0.5, 0, 0.21, 0, 0xe8ebee));    // bowl
    g.add(this.box(0.46, 0.06, 0.5, 0, 0.46, 0, 0xc8ccd0));    // seat rim
    g.add(this.box(0.46, 0.46, 0.18, 0, 0.5, -0.2, 0xe8ebee)); // tank
    return g;
  }

  private buildSink(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.add(this.box(0.18, 0.6, 0.18, 0, 0.3, 0, 0xc8ccd0));     // pedestal
    g.add(this.box(0.46, 0.16, 0.4, 0, 0.66, 0, 0xe8ebee));    // basin
    return g;
  }

  private buildMarker(at: THREE.Vector3): THREE.Mesh {
    // Bright unlit ring so it reads as a UI marker regardless of cell lighting.
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.09, 10, 24),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    );
    mesh.position.copy(at);
    mesh.userData.psKind = 'marker';
    return mesh;
  }
}
