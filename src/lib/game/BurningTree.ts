import * as THREE from 'three';

export class BurningTree {
  private tree: THREE.Group;
  private flames: THREE.Group;
  private flameParticles: { 
    mesh: THREE.Mesh, 
    velocity: THREE.Vector3,
    initialHeight: number,
    flickerPhase: number 
  }[] = [];
  private alive: boolean = true;
  private burnTime: number = 0;
  private readonly maxBurnTime: number = 3.0;
  private isFalling: boolean = false;
  private fallDirection: THREE.Vector3;
  private fallAngle: number = 0;
  private readonly maxFallAngle: number = Math.PI / 2; // 90 degrees in radians
  private pivotPoint: THREE.Vector3;
  private treeHeight: number = 4; // Total height of the tree

  constructor(originalTree: THREE.Group) {
    this.tree = originalTree;
    this.flames = new THREE.Group();
    this.tree.add(this.flames);
    
    // Random fall direction (normalized vector in xz plane)
    const randomAngle = Math.random() * Math.PI * 2;
    this.fallDirection = new THREE.Vector3(
      Math.cos(randomAngle),
      0,
      Math.sin(randomAngle)
    ).normalize();
    
    // Store the base of the tree as pivot point (at ground level)
    this.pivotPoint = this.tree.position.clone();
    
    this.createFlames();
    this.startBurning();
  }

  private createFlames() {
    // Create more detailed flame particles
    const flameCount = 20;
    const flameGeometry = new THREE.ConeGeometry(0.2, 0.8, 8);
    const flameMaterials = [
      new THREE.MeshPhongMaterial({ 
        color: 0xff4400,
        emissive: 0xff4400,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 0.8
      }),
      new THREE.MeshPhongMaterial({ 
        color: 0xff8800,
        emissive: 0xff8800,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 0.8
      }),
      new THREE.MeshPhongMaterial({ 
        color: 0xffaa00,
        emissive: 0xffaa00,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 0.8
      })
    ];

    // Create flames around the foliage
    for (let i = 0; i < flameCount; i++) {
      const material = flameMaterials[Math.floor(Math.random() * flameMaterials.length)].clone();
      const flame = new THREE.Mesh(flameGeometry, material);
      
      // Position flames around the tree's foliage
      const angle = (Math.random() * Math.PI * 2);
      const radius = 0.6 + Math.random() * 0.6;
      const height = 2 + Math.random() * 2;
      
      flame.position.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius
      );

      // Rotate flames to point upward with slight variation
      flame.rotation.x = Math.PI;
      flame.rotation.y = Math.random() * Math.PI * 2;
      flame.rotation.z = (Math.random() - 0.5) * 0.5;

      // Add some random movement to each flame
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        1.5 + Math.random() * 1.5,
        (Math.random() - 0.5) * 0.5
      );

      this.flameParticles.push({ 
        mesh: flame, 
        velocity,
        initialHeight: height,
        flickerPhase: Math.random() * Math.PI * 2
      });
      this.flames.add(flame);
    }

    // Add ember particles
    const emberCount = 15;
    const emberGeometry = new THREE.SphereGeometry(0.05, 4, 4);
    const emberMaterial = new THREE.MeshPhongMaterial({
      color: 0xff8800,
      emissive: 0xff4400,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.8
    });

    for (let i = 0; i < emberCount; i++) {
      const ember = new THREE.Mesh(emberGeometry, emberMaterial);
      const angle = (Math.random() * Math.PI * 2);
      const radius = 0.3 + Math.random() * 0.3;
      const height = 2 + Math.random() * 2;
      
      ember.position.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius
      );

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        2 + Math.random() * 2,
        (Math.random() - 0.5) * 0.8
      );

      this.flameParticles.push({ 
        mesh: ember, 
        velocity,
        initialHeight: height,
        flickerPhase: Math.random() * Math.PI * 2
      });
      this.flames.add(ember);
    }
  }

  private startBurning() {
    // Change tree colors to darker/burnt colors with emissive glow
    this.tree.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.MeshPhongMaterial;
        if (material.color.getHex() !== 0x4a2f1b) { // If not trunk
          material.color.setHex(0x1a1a1a); // Blacken the foliage
          material.emissive.setHex(0x331111); // Add ember glow
          material.emissiveIntensity = 1.0;
        }
      }
    });
  }

  update(deltaTime: number) {
    this.burnTime += deltaTime;
    
    if (this.burnTime >= this.maxBurnTime) {
      if (!this.isFalling) {
        this.isFalling = true;
      }
    }

    const burnRatio = this.burnTime / this.maxBurnTime;
    
    if (this.isFalling) {
      // Calculate fall speed with more realistic acceleration
      const gravity = 9.8;
      const fallAcceleration = gravity * Math.sin(this.fallAngle + 0.1);
      const fallSpeed = Math.min(3.0, fallAcceleration * deltaTime);
      this.fallAngle += fallSpeed;

      // Create rotation axis perpendicular to fall direction
      const rotationAxis = new THREE.Vector3(
        -this.fallDirection.z,
        0,
        this.fallDirection.x
      );

      // Reset position to pivot point and preserve Y rotation
      this.tree.position.copy(this.pivotPoint);
      const originalYRotation = this.tree.rotation.y;
      this.tree.rotation.set(0, originalYRotation, 0);
      
      // Apply the fall rotation
      this.tree.rotateOnAxis(rotationAxis, this.fallAngle);

      // Move the tree's center while keeping the base fixed
      const horizontalOffset = Math.sin(this.fallAngle) * (this.treeHeight / 2);
      
      // Only move in the horizontal direction of fall
      const fallOffset = new THREE.Vector3(
        this.fallDirection.x * horizontalOffset,
        0, // No vertical offset to prevent jumping
        this.fallDirection.z * horizontalOffset
      );
      
      this.tree.position.add(fallOffset);

      // Check if tree has fallen completely
      if (this.fallAngle >= this.maxFallAngle) {
        // Ensure the tree is exactly horizontal
        this.fallAngle = this.maxFallAngle;
        
        // Final position calculation
        const finalOffset = new THREE.Vector3(
          this.fallDirection.x * (this.treeHeight / 2),
          0,
          this.fallDirection.z * (this.treeHeight / 2)
        );
        
        this.tree.position.copy(this.pivotPoint).add(finalOffset);
        this.tree.rotation.set(0, originalYRotation, 0);
        this.tree.rotateOnAxis(rotationAxis, this.maxFallAngle);
        
        this.alive = false;
        return;
      }
    }

    // Update flame particles
    this.flameParticles.forEach(({ mesh, velocity, initialHeight, flickerPhase }) => {
      if (!this.isFalling) {
        // Regular flame animation
        mesh.position.add(velocity.clone().multiplyScalar(deltaTime));
        
        if (mesh.position.y > initialHeight + 3) {
          mesh.position.y = initialHeight;
          mesh.position.x = (Math.random() - 0.5) * 1.2;
          mesh.position.z = (Math.random() - 0.5) * 1.2;
        }

        const flicker = 0.7 + Math.sin(this.burnTime * 10 + flickerPhase) * 0.3;
        mesh.scale.setScalar(flicker * (1 - burnRatio * 0.5));

        const material = mesh.material as THREE.MeshPhongMaterial;
        material.opacity = (1 - burnRatio * 0.5) * flicker;
      } else {
        // Keep flames aligned with gravity while falling
        mesh.rotation.x = -this.fallAngle;
        
        // Fade out flames during falling
        const material = mesh.material as THREE.MeshPhongMaterial;
        material.opacity *= 0.95;
        mesh.scale.multiplyScalar(0.95);
      }
    });
  }

  isAlive(): boolean {
    return this.alive;
  }
} 