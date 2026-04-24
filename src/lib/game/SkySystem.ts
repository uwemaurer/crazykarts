import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const DAY_LENGTH_SEC = 600; // Ten real minutes per in-game day.
const STAR_COUNT = 1400;
const STAR_RADIUS = 500;
const MOON_DISTANCE = 420;
const SUN_LIGHT_DISTANCE = 120;

const DAY_AMBIENT = new THREE.Color(0xb8c8e0);
const NIGHT_AMBIENT = new THREE.Color(0x0b1220);
const DAY_SUN_COLOR = new THREE.Color(0xfff4d8);
const SUNSET_SUN_COLOR = new THREE.Color(0xff9a54);
const DAY_FOG_COLOR = new THREE.Color(0x87ceeb);
const SUNSET_FOG_COLOR = new THREE.Color(0xe8946a);
const NIGHT_FOG_COLOR = new THREE.Color(0x0a1326);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function createMoonTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255, 248, 220, 1)');
  g.addColorStop(0.45, 'rgba(230, 220, 190, 0.85)');
  g.addColorStop(1, 'rgba(200, 190, 150, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SkySystem {
  // Time of day in [0, 1): 0 = midnight, 0.25 = sunrise (east), 0.5 = noon, 0.75 = sunset (west).
  private timeOfDay = 0.35;
  private dayFactor = 1;

  private readonly scene: THREE.Scene;
  private readonly sky: Sky;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly fog: THREE.Fog;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly moon: THREE.Sprite;
  private readonly moonMaterial: THREE.SpriteMaterial;

  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;

    // Sky dome (Preetham scattering).
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 8;
    u.rayleigh.value = 2;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);

    // Fog: replaces the constant blue fog with a per-time tint.
    this.fog = new THREE.Fog(DAY_FOG_COLOR.getHex(), 60, 180);
    scene.fog = this.fog;

    // Ambient light: fills shadows with a tinted base color.
    this.ambient = new THREE.AmbientLight(DAY_AMBIENT.getHex(), 0.35);
    scene.add(this.ambient);

    // Sun: directional light that tracks the sun position. Inherits the shadow
    // config the game sets up below on getDirectionalLight().
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 320;
    this.sunLight.shadow.camera.left = -90;
    this.sunLight.shadow.camera.right = 90;
    this.sunLight.shadow.camera.top = 90;
    this.sunLight.shadow.camera.bottom = -90;
    // Soft, blurred shadows (works with VSMShadowMap on the renderer).
    this.sunLight.shadow.radius = 8;
    this.sunLight.shadow.blurSamples = 25;
    // A bit of bias keeps VSM from light-bleeding through thin blocks.
    this.sunLight.shadow.bias = -0.0003;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Stars: a sphere of points centered on the camera so they appear infinite.
    const starGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sp = Math.sin(phi);
      positions[i * 3]     = STAR_RADIUS * sp * Math.cos(theta);
      positions[i * 3 + 1] = STAR_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = STAR_RADIUS * sp * Math.sin(theta);
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeom, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1; // draw before regular geometry
    scene.add(this.stars);

    // Moon: a sprite that hangs opposite the sun.
    this.moonMaterial = new THREE.SpriteMaterial({
      map: createMoonTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.moon = new THREE.Sprite(this.moonMaterial);
    this.moon.scale.set(48, 48, 1);
    this.moon.renderOrder = -1;
    scene.add(this.moon);

    void camera; // camera passed for future camera-space features (e.g. lens flare).
    this.refresh();
  }

  public getDirectionalLight(): THREE.DirectionalLight {
    return this.sunLight;
  }

  public getTimeOfDay(): number {
    return this.timeOfDay;
  }

  public getNightFactor(): number {
    return 1 - this.dayFactor;
  }

  public setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this.refresh();
  }

  public advance(deltaTime: number): void {
    this.timeOfDay = (this.timeOfDay + deltaTime / DAY_LENGTH_SEC) % 1;
    this.refresh();
  }

  public updateForCamera(camera: THREE.Camera): void {
    // Keep stars and moon centered on the camera so they always look infinitely far.
    this.stars.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(this.moonDir, MOON_DISTANCE);
    // Anchor the sun light's shadow camera near the player.
    this.sunLight.target.position.set(camera.position.x, 0, camera.position.z);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this.sunDir, SUN_LIGHT_DISTANCE);
  }

  private refresh(): void {
    // Angle progresses 0→2π over one day, with timeOfDay=0.25 at sunrise east.
    const angle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    // Slight axial tilt so the sun doesn't pass exactly overhead.
    const tilt = 0.25;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    this.sunDir.set(cx, cy, cy * tilt).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);

    // Sky shader uses sunPosition as a direction; copy the unit vector.
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    // Day factor: 0 below horizon, ramps to 1 as the sun rises.
    const dayFactor = smoothstep(-0.08, 0.25, this.sunDir.y);
    this.dayFactor = dayFactor;
    // Warmth: 1 near horizon, 0 overhead — drives sunset color.
    const warmth = 1 - smoothstep(0.04, 0.45, Math.max(0, this.sunDir.y));

    // Sun light: intensity scales with day factor; color warms toward sunset.
    this.sunLight.intensity = 1.05 * dayFactor;
    this.tmpColor.copy(DAY_SUN_COLOR).lerp(SUNSET_SUN_COLOR, warmth * dayFactor);
    this.sunLight.color.copy(this.tmpColor);

    // Ambient: cross-fade day → night with a touch of warm tint at dusk.
    this.tmpColor.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, dayFactor);
    this.ambient.color.copy(this.tmpColor);
    this.ambient.intensity = 0.28 + dayFactor * 0.25;

    // Fog: night blue → day blue, with a warm tint near the horizon transitions.
    this.tmpColor.copy(NIGHT_FOG_COLOR).lerp(DAY_FOG_COLOR, dayFactor);
    if (warmth > 0.01 && dayFactor > 0.02 && dayFactor < 0.98) {
      this.tmpColor.lerp(SUNSET_FOG_COLOR, warmth * 0.6);
    }
    this.fog.color.copy(this.tmpColor);
    this.scene.background = null; // Sky mesh handles it.

    // Stars & moon fade in as the sun sets.
    const nightFactor = 1 - dayFactor;
    this.starMaterial.opacity = nightFactor;
    this.moonMaterial.opacity = nightFactor;
    this.moon.visible = nightFactor > 0.01;
    this.stars.visible = nightFactor > 0.01;
  }
}
