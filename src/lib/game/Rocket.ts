import * as THREE from 'three';
import { Car } from './Car';
import { Explosion } from './Explosion';

export class Rocket {
  private rocket: THREE.Group;
  private velocity: THREE.Vector3;
  private speed: number = 30;
  private alive: boolean = true;
  private explosion: Explosion | null = null;
  private boundingSphere: THREE.Sphere;
  private lifeTime: number;
  private exploded: boolean;

  constructor(position: THREE.Vector3, direction: THREE.Vector3, carVelocity: THREE.Vector3 = new THREE.Vector3()) {
    this.rocket = new THREE.Group();
    this.velocity = direction.normalize().multiplyScalar(this.speed).add(carVelocity);
    this.createRocket();
    this.rocket.position.copy(position);
    this.rocket.lookAt(position.clone().add(direction));
    
    // Create bounding sphere for collision detection
    this.boundingSphere = new THREE.Sphere(this.rocket.position, 0.3);
    this.lifeTime = 5; // 5 seconds lifetime
    this.exploded = false;
  }

  private createRocket() {
    // Rocket body
    const bodyGeometry = new THREE.CylinderGeometry(0.1, 0.2, 1, 8);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x808080 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    this.rocket.add(body);

    // Rocket tip
    const tipGeometry = new THREE.ConeGeometry(0.2, 0.4, 8);
    const tipMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    const tip = new THREE.Mesh(tipGeometry, tipMaterial);
    tip.position.z = -0.7;
    tip.rotation.x = Math.PI / 2;
    tip.castShadow = true;
    this.rocket.add(tip);
  }

  checkCollision(car: Car): boolean {
    // Update bounding sphere position
    this.boundingSphere.center.copy(this.rocket.position);
    
    // Get car's bounding sphere
    const carBoundingSphere = new THREE.Sphere(
      car.getCar().position,
      2 // Approximate radius of the car
    );

    return this.boundingSphere.intersectsSphere(carBoundingSphere);
  }

  explode() {
    if (!this.exploded) {
      this.exploded = true;
      this.explosion = new Explosion(this.rocket.position.clone(), 0xff4400);
      this.rocket.visible = false;
      
      // Set a timeout for the rocket's death after explosion
      this.lifeTime = 2.0; // Give the explosion 2 seconds to play out
    }
  }

  update(deltaTime: number = 1/60): void {
    // Update lifetime first
    this.lifeTime -= deltaTime;

    if (this.exploded) {
      // Update explosion
      if (this.explosion) {
        this.explosion.update(deltaTime);
        // Mark as dead when explosion is done
        if (!this.explosion.isAlive()) {
          this.alive = false;
        }
      } else {
        // No explosion, mark as dead
        this.alive = false;
      }
    } else {
      // Update position based on velocity
      this.rocket.position.add(this.velocity.clone().multiplyScalar(deltaTime));
      
      // Check if rocket should explode
      if (this.lifeTime <= 0 || this.rocket.position.length() > 200) {
        this.explode();
      }
    }
  }

  getRocket(): THREE.Group {
    return this.rocket;
  }

  getExplosion(): Explosion | null {
    return this.explosion;
  }

  isAlive(): boolean {
    if (!this.alive) return false;
    if (this.exploded && (!this.explosion || !this.explosion.isAlive())) return false;
    return true;
  }

  hasExploded(): boolean {
    return this.exploded;
  }

  getPosition(): THREE.Vector3 {
    return this.rocket.position;
  }

  // Remove unused methods
  destroy() {
    this.alive = false;
  }
} 