import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

export interface WorldChunk {
    mesh: THREE.Group;
    position: THREE.Vector2;
    bounds: THREE.Box3;
}

export class WorldGenerator {
    private noise2D: (x: number, y: number) => number;
    private readonly CHUNK_SIZE = 100;
    private readonly ROAD_WIDTH = 10;
    private readonly HOUSE_SIZE = 8;
    private readonly TREE_SIZE = 4;

    constructor(seed: number = Math.random()) {
        this.noise2D = createNoise2D(() => seed);
    }

    public getHeightAt(x: number, z: number): number {
        return this.noise2D(x * 0.02, z * 0.02) * 2;
    }

    private createGround(chunkX: number, chunkZ: number): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(this.CHUNK_SIZE, this.CHUNK_SIZE, 20, 20);
        geometry.rotateX(-Math.PI / 2);

        // Add some gentle height variation
        const vertices = geometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i] + chunkX * this.CHUNK_SIZE;
            const z = vertices[i + 2] + chunkZ * this.CHUNK_SIZE;
            vertices[i + 1] = this.getHeightAt(x, z);
        }

        const material = new THREE.MeshStandardMaterial({
            color: 0x3d7e52, // Grass green
            roughness: 0.8,
        });

        return new THREE.Mesh(geometry, material);
    }

    private createRoad(length: number): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(this.ROAD_WIDTH, length);
        geometry.rotateX(-Math.PI / 2);
        
        const material = new THREE.MeshStandardMaterial({
            color: 0x505050, // Asphalt gray
            roughness: 0.9,
        });

        return new THREE.Mesh(geometry, material);
    }

    private createHouse(): THREE.Group {
        const house = new THREE.Group();

        // Main building
        const buildingGeometry = new THREE.BoxGeometry(this.HOUSE_SIZE, this.HOUSE_SIZE, this.HOUSE_SIZE);
        const buildingMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc, // Light gray
        });
        const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
        building.position.y = this.HOUSE_SIZE / 2;

        // Roof
        const roofGeometry = new THREE.ConeGeometry(this.HOUSE_SIZE * 0.7, this.HOUSE_SIZE * 0.5, 4);
        const roofMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b4513, // Saddle brown
        });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = this.HOUSE_SIZE + this.HOUSE_SIZE * 0.25;
        roof.rotation.y = Math.PI / 4;

        house.add(building);
        house.add(roof);

        return house;
    }

    private createTree(): THREE.Group {
        const tree = new THREE.Group();

        // Trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, this.TREE_SIZE * 1.5, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b4513, // Brown
            roughness: 0.9,
        });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = this.TREE_SIZE * 0.75;

        // Leaves
        const leavesGeometry = new THREE.ConeGeometry(this.TREE_SIZE / 2, this.TREE_SIZE, 8);
        const leavesMaterial = new THREE.MeshStandardMaterial({
            color: 0x228b22, // Forest green
            roughness: 0.8,
        });
        const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
        leaves.position.y = this.TREE_SIZE * 1.5;

        tree.add(trunk);
        tree.add(leaves);

        return tree;
    }

    public generateChunk(chunkX: number, chunkZ: number): WorldChunk {
        const chunk = new THREE.Group();
        const ground = this.createGround(chunkX, chunkZ);
        chunk.add(ground);

        // Determine if this chunk should have a road
        const hasRoad = Math.abs(chunkX % 3) === 0 || Math.abs(chunkZ % 3) === 0;
        
        if (hasRoad) {
            const road = this.createRoad(this.CHUNK_SIZE);
            road.position.y = 0.1; // Slightly above ground to prevent z-fighting
            
            // Determine road orientation
            if (Math.abs(chunkX % 3) === 0) {
                road.rotation.y = Math.PI / 2;
            }
            chunk.add(road);
        } else {
            // Add houses and trees if there's no road
            const numHouses = Math.floor(Math.random() * 2); // 0-1 houses per chunk
            const numTrees = Math.floor(Math.random() * 5) + 3; // 3-7 trees per chunk

            // Add houses
            for (let i = 0; i < numHouses; i++) {
                const house = this.createHouse();
                const x = (Math.random() - 0.5) * (this.CHUNK_SIZE - this.HOUSE_SIZE);
                const z = (Math.random() - 0.5) * (this.CHUNK_SIZE - this.HOUSE_SIZE);
                house.position.set(x, 0, z);
                house.rotation.y = Math.random() * Math.PI * 2;
                chunk.add(house);
            }

            // Add trees
            for (let i = 0; i < numTrees; i++) {
                const tree = this.createTree();
                const x = (Math.random() - 0.5) * (this.CHUNK_SIZE - this.TREE_SIZE);
                const z = (Math.random() - 0.5) * (this.CHUNK_SIZE - this.TREE_SIZE);
                tree.position.set(x, 0, z);
                chunk.add(tree);
            }
        }

        // Position the chunk
        chunk.position.set(
            chunkX * this.CHUNK_SIZE,
            0,
            chunkZ * this.CHUNK_SIZE
        );

        // Calculate bounds
        const bounds = new THREE.Box3().setFromObject(chunk);

        return {
            mesh: chunk,
            position: new THREE.Vector2(chunkX, chunkZ),
            bounds: bounds
        };
    }

    public getChunkSize(): number {
        return this.CHUNK_SIZE;
    }
} 