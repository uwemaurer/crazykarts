import * as THREE from 'three';

export class Explosion {
  private particles: THREE.Group;
  private debris: THREE.Group;
  private particleVelocities: THREE.Vector3[] = [];
  private debrisVelocities: { velocity: THREE.Vector3; rotation: THREE.Vector3 }[] = [];
  private alive: boolean = true;
  private lifetime: number = 0;
  private maxLifetime: number = 0.5; // Reduced from 1s to 0.5s for faster effect
  private static readonly PARTICLE_SPEED = 25; // Increased particle speed
  private static readonly PARTICLE_SIZE = 0.3; // Increased particle size
  private static readonly DEBRIS_SPEED = 15;
  private static readonly DEBRIS_ROTATION_SPEED = 10;
  private carColor: number;

  constructor(position: THREE.Vector3, carColor: number) {
    this.particles = new THREE.Group();
    this.debris = new THREE.Group();
    this.particles.position.copy(position);
    this.debris.position.copy(position);
    this.carColor = carColor;
    this.createExplosion();
    this.createDebris();
  }

  private createDebris() {
    // Create car parts that will fly away
    const debrisParts = [
      // Wheels
      { geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12), color: 0x333333, scale: 1 },
      { geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12), color: 0x333333, scale: 1 },
      { geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12), color: 0x333333, scale: 1 },
      { geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12), color: 0x333333, scale: 1 },
      // Body panels
      { geometry: new THREE.BoxGeometry(1, 0.5, 1.5), color: this.carColor, scale: 1 },
      { geometry: new THREE.BoxGeometry(1, 0.5, 1.5), color: this.carColor, scale: 1 },
      { geometry: new THREE.BoxGeometry(0.8, 0.4, 1), color: this.carColor, scale: 1 },
      // Hood and trunk
      { geometry: new THREE.BoxGeometry(1.8, 0.2, 1.2), color: this.carColor, scale: 1 },
      { geometry: new THREE.BoxGeometry(1.8, 0.2, 1.2), color: this.carColor, scale: 1 }
    ];

    debrisParts.forEach(part => {
      const material = new THREE.MeshPhongMaterial({ 
        color: part.color,
        emissive: part.color,
        emissiveIntensity: 0.5,
      });
      const debris = new THREE.Mesh(part.geometry, material);
      debris.scale.multiplyScalar(part.scale);

      // Random position offset
      debris.position.set(
        (Math.random() - 0.5) * 1,
        (Math.random() - 0.5) * 1,
        (Math.random() - 0.5) * 1
      );

      // Random velocity with upward bias
      const angle = Math.random() * Math.PI * 2;
      const upwardBias = 0.3 + Math.random() * 0.7; // 0.3 to 1.0 upward component
      const velocity = new THREE.Vector3(
        Math.cos(angle),
        upwardBias,
        Math.sin(angle)
      ).normalize().multiplyScalar(Explosion.DEBRIS_SPEED * (0.8 + Math.random() * 0.4));

      // Random rotation
      const rotation = new THREE.Vector3(
        (Math.random() - 0.5) * Explosion.DEBRIS_ROTATION_SPEED,
        (Math.random() - 0.5) * Explosion.DEBRIS_ROTATION_SPEED,
        (Math.random() - 0.5) * Explosion.DEBRIS_ROTATION_SPEED
      );

      this.debrisVelocities.push({ velocity, rotation });
      this.debris.add(debris);
    });
  }

  private createExplosion() {
    const particleCount = 30; // Increased from 20 to 30 particles
    const particleGeometry = new THREE.SphereGeometry(Explosion.PARTICLE_SIZE, 8, 8);
    
    // Create multiple materials for a more varied explosion
    const particleMaterials = [
      new THREE.MeshPhongMaterial({ 
        color: 0xff4400,
        emissive: 0xff4400,
        emissiveIntensity: 1.0,
        transparent: true
      }),
      new THREE.MeshPhongMaterial({ 
        color: 0xff8800,
        emissive: 0xff8800,
        emissiveIntensity: 1.0,
        transparent: true
      }),
      new THREE.MeshPhongMaterial({ 
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 1.0,
        transparent: true
      })
    ];

    for (let i = 0; i < particleCount; i++) {
      const material = particleMaterials[Math.floor(Math.random() * particleMaterials.length)];
      const particle = new THREE.Mesh(particleGeometry, material);
      
      // Create a more spherical explosion pattern
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      const velocity = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta)
      ).multiplyScalar(Explosion.PARTICLE_SPEED * (0.8 + Math.random() * 0.4)); // Random speed variation
      
      // Initial random offset for more volume
      particle.position.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      );
      
      this.particleVelocities.push(velocity);
      this.particles.add(particle);
    }
  }

  update(deltaTime: number) {
    this.lifetime += deltaTime;
    
    if (this.lifetime >= this.maxLifetime) {
      this.alive = false;
      return;
    }

    const lifetimeRatio = this.lifetime / this.maxLifetime;
    const scale = 1 - Math.pow(lifetimeRatio, 2); // Quadratic scale for faster initial expansion

    // Update particles
    this.particles.children.forEach((object) => {
      const particle = object as THREE.Mesh;
      const index = this.particles.children.indexOf(particle);
      const velocity = this.particleVelocities[index];
      
      particle.position.add(velocity.clone().multiplyScalar(deltaTime));
      
      // Scale particles and adjust their opacity
      particle.scale.setScalar(scale * 2); // Double the initial size
      const material = particle.material as THREE.MeshPhongMaterial;
      material.opacity = scale;
      material.emissiveIntensity = scale * 2;
    });

    // Update debris
    this.debris.children.forEach((object, index) => {
      const debris = object as THREE.Mesh;
      const { velocity, rotation } = this.debrisVelocities[index];
      
      // Apply gravity to velocity
      velocity.y -= 20 * deltaTime; // Gravity effect
      
      // Update position and rotation
      debris.position.add(velocity.clone().multiplyScalar(deltaTime));
      debris.rotation.x += rotation.x * deltaTime;
      debris.rotation.y += rotation.y * deltaTime;
      debris.rotation.z += rotation.z * deltaTime;
    });
  }

  getExplosion(): THREE.Group {
    return this.particles;
  }

  getDebris(): THREE.Group {
    return this.debris;
  }

  isAlive(): boolean {
    return this.alive;
  }
} 