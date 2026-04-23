import * as THREE from 'three';

export interface BlockHighlightOptions {
  edgeColor?: number;
  edgeOpacity?: number;
  fillColor?: number;
  fillOpacity?: number;
  boxScale?: number;
}

export class BlockHighlight {
  private readonly group: THREE.Group;
  private readonly fill: THREE.Mesh | null;
  private readonly edges: THREE.LineSegments;
  private visible = false;

  constructor(opts: BlockHighlightOptions = {}) {
    const {
      edgeColor = 0xffee55,
      edgeOpacity = 0.95,
      fillColor = 0xffffff,
      fillOpacity = 0.12,
      boxScale = 1.02,
    } = opts;

    this.group = new THREE.Group();

    if (fillOpacity > 0) {
      const fillGeom = new THREE.BoxGeometry(boxScale - 0.01, boxScale - 0.01, boxScale - 0.01);
      const fillMat = new THREE.MeshBasicMaterial({
        color: fillColor,
        transparent: true,
        opacity: fillOpacity,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      this.fill = new THREE.Mesh(fillGeom, fillMat);
      this.group.add(this.fill);
    } else {
      this.fill = null;
    }

    const edgesGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(boxScale, boxScale, boxScale));
    const edgeMat = new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: edgeOpacity,
      depthTest: true,
    });
    this.edges = new THREE.LineSegments(edgesGeom, edgeMat);
    this.group.add(this.edges);

    this.group.visible = false;
  }

  public getObject(): THREE.Object3D {
    return this.group;
  }

  public setTarget(wx: number, wy: number, wz: number): void {
    this.group.position.set(wx + 0.5, wy + 0.5, wz + 0.5);
    if (!this.visible) {
      this.group.visible = true;
      this.visible = true;
    }
  }

  public hide(): void {
    if (this.visible) {
      this.group.visible = false;
      this.visible = false;
    }
  }
}
