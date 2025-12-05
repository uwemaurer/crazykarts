import * as THREE from 'three';

export class Slime {
  private slime: THREE.Group;
  private particles: THREE.Mesh[] = [];
  private alive: boolean = true;
  private lifetime: number = 0;
  private readonly DURATION = 1.5; // Slime lasts 1.5 seconds

  constructor(position: THREE.Vector3) {
    this.slime = new THREE.Group();
    this.slime.position.copy(position);
    this.createSlime();
  }

  private createSlime() {
    // Create slime splat on the ground
    const splatGeometry = new THREE.CircleGeometry(1, 16);
    const splatMaterial = new THREE.MeshBasicMaterial({
      color: 0x4dff4d,  // Bright green slime
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const splat = new THREE.Mesh(splatGeometry, splatMaterial);
    splat.rotation.x = -Math.PI / 2; // Lay flat on ground
    splat.position.y = 0.1; // Slightly above ground
    this.slime.add(splat);

    // Create slime particles that scatter outward
    const particleCount = 12;
    const particleGeometry = new THREE.SphereGeometry(0.15, 8, 8);
    const particleMaterial = new THREE.MeshPhongMaterial({
      color: 0x3dd13d,  // Darker green
      shininess: 100,
      transparent: true,
      opacity: 1
    });

    for (let i = 0; i < particleCount; i++) {
      const particle = new THREE.Mesh(particleGeometry, particleMaterial.clone());
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 0.5 + Math.random() * 0.5;

      particle.position.set(
        Math.cos(angle) * radius,
        0.2 + Math.random() * 0.5,
        Math.sin(angle) * radius
      );

      // Store velocity for animation
      (particle as any).velocity = new THREE.Vector3(
        Math.cos(angle) * (2 + Math.random() * 2),
        2 + Math.random() * 3,
        Math.sin(angle) * (2 + Math.random() * 2)
      );

      this.particles.push(particle);
      this.slime.add(particle);
    }
  }

  public getSlime(): THREE.Group {
    return this.slime;
  }

  public isAlive(): boolean {
    return this.alive;
  }

  public update(deltaTime: number) {
    this.lifetime += deltaTime;

    // Animate particles
    this.particles.forEach(particle => {
      const velocity = (particle as any).velocity as THREE.Vector3;

      // Apply gravity
      velocity.y -= 9.8 * deltaTime;

      // Update position
      particle.position.add(velocity.clone().multiplyScalar(deltaTime));

      // Stop at ground
      if (particle.position.y < 0.1) {
        particle.position.y = 0.1;
        velocity.y = 0;
        velocity.x *= 0.9; // Friction
        velocity.z *= 0.9;
      }

      // Fade out
      const fadeStart = this.DURATION * 0.5;
      if (this.lifetime > fadeStart) {
        const fadeProgress = (this.lifetime - fadeStart) / (this.DURATION - fadeStart);
        (particle.material as THREE.MeshPhongMaterial).opacity = 1 - fadeProgress;
      }
    });

    // Fade out splat
    const splatFadeStart = this.DURATION * 0.3;
    if (this.lifetime > splatFadeStart) {
      const splat = this.slime.children[0] as THREE.Mesh;
      const fadeProgress = (this.lifetime - splatFadeStart) / (this.DURATION - splatFadeStart);
      (splat.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - fadeProgress);
    }

    // Check if finished
    if (this.lifetime >= this.DURATION) {
      this.alive = false;
    }
  }
}
