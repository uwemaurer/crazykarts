import * as THREE from 'three';
import gsap from 'gsap';
import type { BlockId } from './voxel/BlockTypes';
import { BLOCK_TEXTURES } from './voxel/BlockTypes';
import { getTileTexture } from './voxel/TextureGenerator';

export type ViewModelKind = 'pickaxe' | 'axe' | 'block' | 'none';

export class ViewModel {
  private readonly group = new THREE.Group();
  private readonly pickaxe: THREE.Group;
  private readonly axe: THREE.Group;
  private readonly block: THREE.Mesh;
  private readonly blockMaterials: THREE.MeshLambertMaterial[];

  // Rest pose in camera-local space. Tool sits in the lower-right corner.
  private readonly restPos = new THREE.Vector3(0.38, -0.3, -0.55);
  private activeSwing: gsap.core.Timeline | null = null;

  constructor() {
    this.pickaxe = this.buildPickaxe();
    this.axe = this.buildAxe();
    this.block = this.buildBlockCube();
    this.blockMaterials = this.block.material as THREE.MeshLambertMaterial[];

    this.group.add(this.pickaxe);
    this.group.add(this.axe);
    this.group.add(this.block);

    this.group.position.copy(this.restPos);
    // Keep the viewmodel in the near-camera range so it never gets clipped or fogged.
    this.group.renderOrder = 10;

    this.setKind('pickaxe');
  }

  public getObject(): THREE.Object3D {
    return this.group;
  }

  private lastBlock: BlockId | null = null;
  public setKind(kind: ViewModelKind, block?: BlockId): void {
    this.pickaxe.visible = kind === 'pickaxe';
    this.axe.visible = kind === 'axe';
    this.block.visible = kind === 'block';
    if (kind === 'block' && block !== undefined && block !== this.lastBlock) {
      this.lastBlock = block;
      const tex = BLOCK_TEXTURES[block];
      if (tex) {
        // BoxGeometry material order: +X, -X, +Y (top), -Y (bottom), +Z, -Z.
        const layers = [tex.side, tex.side, tex.top, tex.bottom, tex.side, tex.side];
        for (let i = 0; i < 6; i++) {
          this.blockMaterials[i].map = getTileTexture(layers[i]);
          this.blockMaterials[i].needsUpdate = true;
        }
      }
    }
  }

  public swing(): void {
    if (this.activeSwing) this.activeSwing.kill();
    // Snap back to rest before a new swing so we don't compound partial states.
    this.group.rotation.set(0, 0, 0);
    this.group.position.copy(this.restPos);
    this.activeSwing = this.axe.visible ? this.buildAxeSwing() : this.buildStrikeSwing();
  }

  // Vertical pickaxe / tap-style strike used for pickaxe and block placement.
  private buildStrikeSwing(): gsap.core.Timeline {
    const rest = this.restPos;
    const tl = gsap.timeline({
      onComplete: () => {
        this.group.rotation.set(0, 0, 0);
        this.group.position.copy(rest);
        this.activeSwing = null;
      },
    });

    tl.to(this.group.rotation, { x: 0.15, duration: 0.05, ease: 'power1.out' }, 0);
    tl.to(this.group.rotation, { x: -0.7, z: 0.22, duration: 0.08, ease: 'power2.out' }, 0.05);
    tl.to(this.group.position, {
      y: rest.y - 0.06, z: rest.z - 0.12,
      duration: 0.08, ease: 'power2.out',
    }, 0.05);
    tl.to(this.group.rotation, { x: 0, z: 0, duration: 0.14, ease: 'power2.inOut' }, 0.13);
    tl.to(this.group.position, {
      y: rest.y, z: rest.z,
      duration: 0.14, ease: 'power2.inOut',
    }, 0.13);

    return tl;
  }

  // Horizontal axe chop: player winds back to the right, then swings in to the
  // middle of the view where the crosshair is — does NOT cross past to the left.
  // The axe's base yaw is +0.35 (blade angled rightward). Outer rotation.y of
  // -0.35 cancels that to put the blade facing dead forward at impact.
  private buildAxeSwing(): gsap.core.Timeline {
    const rest = this.restPos;
    const tl = gsap.timeline({
      onComplete: () => {
        this.group.rotation.set(0, 0, 0);
        this.group.position.copy(rest);
        this.activeSwing = null;
      },
    });

    // Anticipation: shoulder the axe back and to the right.
    tl.to(this.group.rotation, {
      y: 0.55, z: -0.25, x: -0.18,
      duration: 0.11, ease: 'power1.out',
    }, 0);
    tl.to(this.group.position, {
      x: rest.x + 0.22, y: rest.y + 0.12, z: rest.z + 0.04,
      duration: 0.11, ease: 'power1.out',
    }, 0);

    // Strike: fast sweep into the CENTER of the view (not past it).
    tl.to(this.group.rotation, {
      y: -0.35, z: 0.35, x: 0.22,
      duration: 0.13, ease: 'power4.out',
    }, 0.11);
    tl.to(this.group.position, {
      x: 0.02, y: rest.y - 0.05, z: rest.z - 0.14,
      duration: 0.13, ease: 'power4.out',
    }, 0.11);

    // Impact hold: axe buried at center for a beat.
    tl.to(this.group.rotation, {
      y: -0.32, z: 0.33, x: 0.2,
      duration: 0.06, ease: 'none',
    }, 0.24);

    // Return to rest (slower, eased).
    tl.to(this.group.rotation, {
      y: 0, z: 0, x: 0,
      duration: 0.22, ease: 'power2.inOut',
    }, 0.30);
    tl.to(this.group.position, {
      x: rest.x, y: rest.y, z: rest.z,
      duration: 0.22, ease: 'power2.inOut',
    }, 0.30);

    return tl;
  }

  private mat(color: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color, fog: false });
  }

  private buildPickaxe(): THREE.Group {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.5, 0.035), this.mat(0x7c4a20));
    g.add(handle);

    // Head long axis runs front-back (Z) so the two spikes point toward/away from the target.
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), this.mat(0x9aa0a8));
    head.position.set(0, 0.25, 0);
    g.add(head);

    // Small collar where head meets handle for definition.
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), this.mat(0x5e636b));
    collar.position.set(0, 0.22, 0);
    g.add(collar);

    g.rotation.z = -0.4;
    g.rotation.y = 0.35;
    g.rotation.x = 0.25;
    return g;
  }

  private buildAxe(): THREE.Group {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.5, 0.035), this.mat(0x7c4a20));
    g.add(handle);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.04), this.mat(0xc8a96a));
    blade.position.set(0.12, 0.2, 0);
    g.add(blade);

    const bladeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.045), this.mat(0xe0cfa0));
    bladeEdge.position.set(0.22, 0.2, 0);
    g.add(bladeEdge);

    g.rotation.z = -0.4;
    g.rotation.y = 0.35;
    g.rotation.x = 0.25;
    return g;
  }

  private buildBlockCube(): THREE.Mesh {
    const geom = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const mats = [
      this.mat(0xffffff), this.mat(0xffffff),
      this.mat(0xffffff), this.mat(0xffffff),
      this.mat(0xffffff), this.mat(0xffffff),
    ];
    const m = new THREE.Mesh(geom, mats);
    m.rotation.y = 0.4;
    m.rotation.x = 0.25;
    return m;
  }
}
