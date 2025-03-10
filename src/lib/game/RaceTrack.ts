import * as THREE from 'three';
import { BurningTree } from './BurningTree';
import { House } from './House';

export class RaceTrack {
  private track: THREE.Group;
  private static readonly TRACK_WIDTH = 20;
  private static readonly TRACK_LENGTH = 60;
  private trees: THREE.Group[] = [];
  private burningTrees: BurningTree[] = [];
  private houses: House[] = [];
  private static readonly HOUSE_COUNT = 12;

  constructor() {
    this.track = new THREE.Group();
    this.createTrack();
  }

  private createTree(position: THREE.Vector3): THREE.Group {
    const tree = new THREE.Group();

    // Create tree trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.4, 2, 8);
    const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x4a2f1b });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 1;
    trunk.castShadow = true;
    tree.add(trunk);

    // Create tree foliage (multiple layers for fuller look)
    const foliageColors = [0x2d5a27, 0x1a4f16, 0x3d7a3d];
    const foliageSizes = [1.8, 1.4, 1];
    const foliageHeights = [2.8, 3.3, 3.8];

    foliageSizes.forEach((size, index) => {
      const foliageGeometry = new THREE.ConeGeometry(size, 2, 8);
      const foliageMaterial = new THREE.MeshPhongMaterial({ 
        color: foliageColors[index],
        flatShading: true 
      });
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
      foliage.position.y = foliageHeights[index];
      foliage.castShadow = true;
      tree.add(foliage);
    });

    // Add some random rotation and position variation
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.position.copy(position);
    tree.position.x += (Math.random() - 0.5) * 2; // Random x offset
    tree.position.z += (Math.random() - 0.5) * 2; // Random z offset
    
    return tree;
  }

  private createTrack() {
    // Create the ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x2d5a27, // Darker grass color
      side: THREE.FrontSide // Changed from DoubleSide to FrontSide
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01; // Slightly below zero
    ground.receiveShadow = true;
    this.track.add(ground);

    // Create the actual race track surface
    const trackGeometry = new THREE.PlaneGeometry(RaceTrack.TRACK_WIDTH, RaceTrack.TRACK_LENGTH);
    const trackMaterial = new THREE.MeshPhongMaterial({
      color: 0x3c3c3c, // Dark gray for track
      side: THREE.FrontSide, // Changed from DoubleSide to FrontSide
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const trackSurface = new THREE.Mesh(trackGeometry, trackMaterial);
    trackSurface.rotation.x = -Math.PI / 2;
    trackSurface.position.y = 0; // At exactly zero
    trackSurface.receiveShadow = true;
    this.track.add(trackSurface);

    // Add houses around the track
    const houseRadius = 35; // Distance from track center
    for (let i = 0; i < RaceTrack.HOUSE_COUNT; i++) {
      const angle = (i / RaceTrack.HOUSE_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * houseRadius;
      const z = Math.sin(angle) * houseRadius;
      
      // Add some randomness to position
      const randomOffset = 5;
      const randomX = x + (Math.random() - 0.5) * randomOffset;
      const randomZ = z + (Math.random() - 0.5) * randomOffset;
      
      const house = new House(new THREE.Vector3(randomX, 0, randomZ));
      this.houses.push(house);
      this.track.add(house.getHouse());
    }

    // Add some houses in clusters
    const clusterCenters = [
      { x: 45, z: 45 },
      { x: -45, z: 45 },
      { x: 45, z: -45 },
      { x: -45, z: -45 }
    ];

    clusterCenters.forEach(center => {
      const clusterSize = 2 + Math.floor(Math.random() * 3); // 2-4 houses per cluster
      for (let i = 0; i < clusterSize; i++) {
        const offset = 8;
        const x = center.x + (Math.random() - 0.5) * offset;
        const z = center.z + (Math.random() - 0.5) * offset;
        const house = new House(new THREE.Vector3(x, 0, z));
        this.houses.push(house);
        this.track.add(house.getHouse());
      }
    });

    // Add trees along the track
    const treeSpacing = 8; // Space between trees
    const treeOffset = RaceTrack.TRACK_WIDTH / 2 + 2; // Distance from track edge

    // Place trees along both sides
    for (let z = -RaceTrack.TRACK_LENGTH / 2; z <= RaceTrack.TRACK_LENGTH / 2; z += treeSpacing) {
      // Left side trees
      const leftTree = this.createTree(new THREE.Vector3(-treeOffset, 0, z));
      this.trees.push(leftTree);
      this.track.add(leftTree);
      
      // Right side trees
      const rightTree = this.createTree(new THREE.Vector3(treeOffset, 0, z));
      this.trees.push(rightTree);
      this.track.add(rightTree);

      // Add some random trees further out
      if (Math.random() < 0.5) {
        const farOffset = treeOffset + 4 + Math.random() * 4;
        const randomZ = z + (Math.random() - 0.5) * treeSpacing;
        
        const farLeftTree = this.createTree(new THREE.Vector3(-farOffset, 0, randomZ));
        this.trees.push(farLeftTree);
        this.track.add(farLeftTree);
        
        const farRightTree = this.createTree(new THREE.Vector3(farOffset, 0, randomZ));
        this.trees.push(farRightTree);
        this.track.add(farRightTree);
      }
    }
  }

  checkRocketCollision(rocketPosition: THREE.Vector3, radius: number = 0.3): { object: THREE.Group | null, type: 'tree' | 'house' | null } {
    // Check tree collisions
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i];
      if (!tree.visible) continue; // Skip already burning trees
      
      const treePos = tree.position;
      // Check collision with the entire height of the tree (from base to top)
      for (let height = 0; height <= 4; height += 1) {
        const distance = new THREE.Vector3(
          treePos.x - rocketPosition.x,
          (treePos.y + height) - rocketPosition.y,
          treePos.z - rocketPosition.z
        ).length();

        if (distance < 3) { // Increased collision radius from 2 to 3
          return { object: tree, type: 'tree' };
        }
      }
    }

    // Check house collisions
    for (const house of this.houses) {
      if (house.checkCollision(rocketPosition)) {
        return { object: house.getHouse(), type: 'house' };
      }
    }

    return { object: null, type: null };
  }

  setTreeOnFire(tree: THREE.Group) {
    const burningTree = new BurningTree(tree);
    this.burningTrees.push(burningTree);
  }

  update(deltaTime: number) {
    // Update burning trees
    this.burningTrees = this.burningTrees.filter(tree => {
      tree.update(deltaTime);
      return tree.isAlive();
    });
  }

  getTrack(): THREE.Group {
    return this.track;
  }
}
