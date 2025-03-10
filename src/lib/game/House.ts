import * as THREE from 'three';

export class House {
  private house: THREE.Group;
  private size: { width: number; height: number; depth: number };
  private static readonly COLLISION_MARGIN = 2; // Extra margin for collision detection

  constructor(position: THREE.Vector3) {
    this.house = new THREE.Group();
    this.size = {
      width: 4 + Math.random() * 2,
      height: 3 + Math.random() * 2,
      depth: 4 + Math.random() * 2
    };
    this.createHouse();
    this.house.position.copy(position);
    
    // Random rotation for variety
    this.house.rotation.y = Math.random() * Math.PI * 2;
  }

  private createHouse() {
    // Main house body
    const bodyGeometry = new THREE.BoxGeometry(this.size.width, this.size.height, this.size.depth);
    const bodyMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(Math.random() * 0.3 + 0.7, Math.random() * 0.3 + 0.7, Math.random() * 0.3 + 0.7)
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = this.size.height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.house.add(body);

    // Roof
    const roofHeight = this.size.height * 0.5;
    const roofGeometry = new THREE.ConeGeometry(this.size.width * 0.7, roofHeight, 4);
    const roofMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0.8, 0.2, 0.2)
    });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = this.size.height + roofHeight / 2;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.house.add(roof);

    // Door
    const doorWidth = this.size.width * 0.2;
    const doorHeight = this.size.height * 0.6;
    const doorGeometry = new THREE.BoxGeometry(doorWidth, doorHeight, 0.1);
    const doorMaterial = new THREE.MeshPhongMaterial({ color: 0x4a3520 });
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, doorHeight / 2, this.size.depth / 2 + 0.1);
    this.house.add(door);

    // Windows
    const windowSize = this.size.width * 0.2;
    const windowGeometry = new THREE.BoxGeometry(windowSize, windowSize, 0.1);
    const windowMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x87ceeb,
      transparent: true,
      opacity: 0.6
    });

    // Front windows
    const numWindows = 2;
    const windowSpacing = this.size.width * 0.4;
    for (let i = 0; i < numWindows; i++) {
      const windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
      windowMesh.position.set(
        -windowSpacing/2 + i * windowSpacing,
        this.size.height * 0.7,
        this.size.depth / 2 + 0.1
      );
      this.house.add(windowMesh);
    }

    // Side windows
    for (let side = -1; side <= 1; side += 2) {
      const sideWindow = new THREE.Mesh(windowGeometry, windowMaterial);
      sideWindow.position.set(
        this.size.width / 2 * side + 0.1 * side,
        this.size.height * 0.7,
        0
      );
      sideWindow.rotation.y = Math.PI / 2;
      this.house.add(sideWindow);
    }

    // Optional chimney (50% chance)
    if (Math.random() > 0.5) {
      const chimneyWidth = this.size.width * 0.15;
      const chimneyHeight = roofHeight * 1.2;
      const chimneyGeometry = new THREE.BoxGeometry(chimneyWidth, chimneyHeight, chimneyWidth);
      const chimneyMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
      const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
      chimney.position.set(
        this.size.width * 0.25,
        this.size.height + roofHeight * 0.8,
        this.size.width * 0.25
      );
      chimney.castShadow = true;
      this.house.add(chimney);
    }
  }

  checkCollision(position: THREE.Vector3): boolean {
    // Transform the position to the house's local space
    const localPos = position.clone().sub(this.house.position);
    localPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.house.rotation.y);

    // Check if the position is within the house bounds (including roof height and margin)
    const totalHeight = this.size.height + (this.size.height * 0.5); // Include roof height
    return Math.abs(localPos.x) < (this.size.width / 2 + House.COLLISION_MARGIN) &&
           Math.abs(localPos.z) < (this.size.depth / 2 + House.COLLISION_MARGIN) &&
           localPos.y < (totalHeight + House.COLLISION_MARGIN) &&
           localPos.y > -House.COLLISION_MARGIN;
  }

  getHouse(): THREE.Group {
    return this.house;
  }

  getPosition(): THREE.Vector3 {
    return this.house.position;
  }
} 