import * as THREE from 'three';
import gsap from 'gsap';
import type { HousePlot } from './WorldGenerator';

// Furnishings for one village house: wall torches that light up at night,
// a bed, a couple of tables, and a hinged door over the doorway. The bed and
// door are click targets — the door swings open, the bed reports a 'sleep'
// action back to Game. Built once when its village activates; geometry is
// laid out to match WorldGenerator.stampHouse.

export type HouseClickAction = 'sleep' | 'door' | null;

const WOOD_DARK = 0x4a3520;
const WOOD_MED = 0x6b4a28;
const TABLE_TOP = 0x7a5630;
const BED_FRAME = 0x5a3a1c;
const MATTRESS = 0x9aa6b4;
const PILLOW = 0xe2e6ea;
const FLAME_OUTER = 0xff7a1e;
const FLAME_INNER = 0xffd86a;

// Torches switch on once it's this dark (SkySystem.getNightFactor()).
const TORCH_NIGHT_THRESHOLD = 0.45;

export class HouseInterior {
  private readonly group = new THREE.Group();
  private readonly bedPosition = new THREE.Vector3();
  private readonly bedGroup: THREE.Group;
  private readonly doorHinge = new THREE.Group();
  private readonly flames: THREE.Object3D[] = [];

  private flameTime = Math.random() * 10;
  private lit = false;
  private doorOpen = false;
  private doorAnimating = false;

  constructor(house: HousePlot) {
    const halfW = Math.floor(house.w / 2);
    const halfD = Math.floor(house.d / 2);
    const minX = house.x - halfW;
    const maxX = house.x + halfW;
    const minZ = house.z - halfD;
    const maxZ = house.z + halfD;
    const fy = house.floorY;
    const cx = house.x + 0.5; // interior centre, world units
    const cz = house.z + 0.5;

    // Torches on three interior walls (the fourth wall holds the door). Each
    // sits one block off-centre: the centre of these walls is a window.
    this.addTorch(minX + 1.06, fy + 2.1, cz - 1, 0);            // left wall, faces +X
    this.addTorch(maxX - 0.06, fy + 2.1, cz - 1, Math.PI);      // right wall, faces -X
    this.addTorch(cx - 1, fy + 2.1, minZ + 1.06, -Math.PI / 2); // back wall, faces +Z

    // Bed against the back wall.
    this.bedPosition.set(cx, fy, minZ + 1.65);
    this.bedGroup = this.buildBed(this.bedPosition);
    this.group.add(this.bedGroup);

    // A couple of tables tucked along the other walls.
    this.group.add(this.buildTable(maxX - 1.1, fy, cz + 0.4));
    this.group.add(this.buildTable(minX + 1.2, fy, maxZ - 1.3));

    // Door over the south doorway. Hinge at the doorway's left edge so the
    // panel swings outward (+Z) when opened.
    this.doorHinge.position.set(house.x, fy, maxZ + 0.5);
    this.doorHinge.add(this.box(0.92, 1.92, 0.16, 0.46, 0.96, 0, WOOD_MED));
    this.doorHinge.add(this.box(0.1, 0.1, 0.12, 0.82, 1.0, 0.12, 0x2a2a2e)); // handle
    this.doorHinge.userData.hiKind = 'door';
    this.group.add(this.doorHinge);
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

  public getBedPosition(): THREE.Vector3 {
    return this.bedPosition;
  }

  public getClickables(): THREE.Object3D[] {
    return [this.doorHinge, this.bedGroup];
  }

  // Resolves a raycast hit to a house action. Toggles the door itself;
  // leaves the sleep handling to Game.
  public handleClick(hit: THREE.Object3D): HouseClickAction {
    let o: THREE.Object3D | null = hit;
    let kind: string | undefined;
    while (o) {
      if (o.userData.hiKind) { kind = o.userData.hiKind as string; break; }
      o = o.parent;
    }
    if (kind === 'door') { this.toggleDoor(); return 'door'; }
    if (kind === 'bed') return 'sleep';
    return null;
  }

  public update(deltaTime: number, nightFactor: number): void {
    const shouldLight = nightFactor > TORCH_NIGHT_THRESHOLD;
    if (shouldLight !== this.lit) {
      this.lit = shouldLight;
      for (const f of this.flames) f.visible = shouldLight;
    }
    if (this.lit) {
      this.flameTime += deltaTime;
      const flicker = 0.9 + Math.sin(this.flameTime * 11) * 0.07 + Math.sin(this.flameTime * 23) * 0.04;
      for (const f of this.flames) f.scale.setScalar(flicker);
    }
  }

  private toggleDoor(): void {
    if (this.doorAnimating) return;
    this.doorAnimating = true;
    this.doorOpen = !this.doorOpen;
    gsap.to(this.doorHinge.rotation, {
      y: this.doorOpen ? -Math.PI / 2 : 0,
      duration: 0.4,
      ease: 'power2.out',
      onComplete: () => { this.doorAnimating = false; },
    });
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

  private addTorch(x: number, y: number, z: number, yaw: number): void {
    const torch = new THREE.Group();
    torch.position.set(x, y, z);
    torch.rotation.y = yaw;

    torch.add(this.box(0.12, 0.12, 0.12, 0, -0.1, 0, WOOD_DARK)); // wall bracket
    const stick = this.box(0.07, 0.5, 0.07, 0.16, 0.16, 0, WOOD_DARK);
    stick.rotation.z = -0.6; // leans into the room
    torch.add(stick);

    // Unlit flames are MeshBasicMaterial so they read as glowing regardless
    // of the (dark, indoor) scene lighting once switched on.
    const flame = new THREE.Group();
    flame.position.set(0.32, 0.4, 0);
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.26, 0.16),
      new THREE.MeshBasicMaterial({ color: FLAME_OUTER }),
    );
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.16, 0.08),
      new THREE.MeshBasicMaterial({ color: FLAME_INNER }),
    );
    inner.position.y = 0.05;
    flame.add(outer, inner);
    flame.visible = false; // update() decides based on the night factor
    torch.add(flame);

    this.flames.push(flame);
    this.group.add(torch);
  }

  private buildBed(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    g.add(this.box(1.8, 0.26, 0.85, 0, 0.16, 0, BED_FRAME));
    g.add(this.box(1.7, 0.16, 0.74, 0, 0.36, 0, MATTRESS));
    g.add(this.box(0.42, 0.14, 0.66, -0.62, 0.5, 0, PILLOW));
    g.userData.hiKind = 'bed';
    return g;
  }

  private buildTable(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.add(this.box(0.16, 0.6, 0.16, 0, 0.3, 0, WOOD_DARK));  // pedestal
    g.add(this.box(0.9, 0.12, 0.7, 0, 0.66, 0, TABLE_TOP));  // top
    return g;
  }
}
