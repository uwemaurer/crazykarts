import * as THREE from 'three';

interface DirtParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
}

const DIRT_GEOM = new THREE.BoxGeometry(0.15, 0.15, 0.15);
const DIRT_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });

export class DirtParticles {
  private readonly group = new THREE.Group();
  private readonly particles: DirtParticle[] = [];

  public getGroup(): THREE.Group {
    return this.group;
  }

  public spawn(position: THREE.Vector3, backDir: THREE.Vector3, count: number = 2): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(DIRT_GEOM, DIRT_MATERIAL);
      mesh.position.copy(position);
      mesh.position.x += (Math.random() - 0.5) * 0.3;
      mesh.position.z += (Math.random() - 0.5) * 0.3;
      mesh.castShadow = false;

      const backSpeed = 4 + Math.random() * 4;
      const upSpeed = 2 + Math.random() * 3;
      const velocity = backDir.clone().multiplyScalar(backSpeed);
      velocity.x += (Math.random() - 0.5) * 3;
      velocity.z += (Math.random() - 0.5) * 3;
      velocity.y = upSpeed;

      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
      );

      const maxLife = 0.5 + Math.random() * 0.4;
      this.group.add(mesh);
      this.particles.push({ mesh, velocity, spin, life: maxLife, maxLife });
    }
  }

  public update(deltaTime: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= deltaTime;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      p.velocity.y -= 20 * deltaTime;
      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.mesh.rotation.x += p.spin.x * deltaTime;
      p.mesh.rotation.y += p.spin.y * deltaTime;
      p.mesh.rotation.z += p.spin.z * deltaTime;

      const t = p.life / p.maxLife;
      p.mesh.scale.setScalar(Math.max(0.2, t));
    }
  }
}
