import * as THREE from 'three';
import type { WorldGenerator } from './WorldGenerator';
import { GRASS } from './voxel/BlockTypes';

// Per-block density. Each GRASS block contributes BLADES_PER_BLOCK blades to
// the chunk's instanced mesh.
const BLADES_PER_BLOCK = 6;
// Base blade size; per-instance scale varies it.
const BLADE_WIDTH = 0.09;
const BLADE_HEIGHT = 0.55;
const CHUNK_W = 32;

/**
 * Curved, tapering 5-vertex blade geometry:
 *   4 --- tip
 *   |
 *   2-3    mid
 *   |
 *   0-1    base
 * 3 triangles (0,1,3), (0,3,2), (2,3,4). Tapers from wide base to thin tip.
 */
function createBladeGeometry(): THREE.BufferGeometry {
  const w = BLADE_WIDTH;
  const h = BLADE_HEIGHT;
  const positions = new Float32Array([
    -w * 0.5, 0.0, 0,   // 0 base-left
     w * 0.5, 0.0, 0,   // 1 base-right
    -w * 0.3, h * 0.5, 0, // 2 mid-left
     w * 0.3, h * 0.5, 0, // 3 mid-right
     0.0,     h, 0,     // 4 tip
  ]);
  // UV.y carries "blade height" (0 at base, 1 at tip) — used by the wind shader.
  const uvs = new Float32Array([
    0.0, 0.0,
    1.0, 0.0,
    0.1, 0.5,
    0.9, 0.5,
    0.5, 1.0,
  ]);
  // All normals face +Z in blade-local space. Rotated per-instance.
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 3,
    0, 3, 2,
    2, 3, 4,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

export class GrassSystem {
  private readonly scene: THREE.Scene;
  private readonly worldGenerator: WorldGenerator;
  private readonly chunkMeshes = new Map<string, THREE.InstancedMesh>();
  private visible = true;

  private readonly bladeGeometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
    uWindStrength: { value: 0.28 },
    uWindFreq: { value: 0.35 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uBaseColor: { value: new THREE.Color(0x2c5c26) },
    uMidColor: { value: new THREE.Color(0x5aa246) },
    uTipColor: { value: new THREE.Color(0xc9e07a) },
    uBacklightColor: { value: new THREE.Color(0xffe9a8) },
  };

  constructor(scene: THREE.Scene, worldGenerator: WorldGenerator) {
    this.scene = scene;
    this.worldGenerator = worldGenerator;
    this.bladeGeometry = createBladeGeometry();
    this.material = this.createMaterial();
  }

  public setSunDir(dir: THREE.Vector3): void {
    this.uniforms.uSunDir.value.copy(dir);
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const mesh of this.chunkMeshes.values()) mesh.visible = visible;
  }

  public update(deltaTime: number): void {
    this.uniforms.uTime.value += deltaTime;
  }

  public addChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.chunkMeshes.has(key)) return;
    const voxels = this.worldGenerator.getChunkVoxels(cx, cz);
    if (!voxels) return;

    const positions: Array<[number, number, number, number, number, number]> = [];
    // (worldX, worldY, worldZ, yaw, scaleY, scaleXZ)
    for (let lx = 0; lx < voxels.sizeX; lx++) {
      for (let lz = 0; lz < voxels.sizeZ; lz++) {
        // Find top solid block in this column.
        let topY = -1;
        for (let y = voxels.sizeY - 1; y >= 0; y--) {
          const b = voxels.get(lx, y, lz);
          if (b === 0) continue;
          topY = y;
          break;
        }
        if (topY < 0) continue;
        if (voxels.get(lx, topY, lz) !== GRASS) continue;

        const worldBaseY = topY + 1; // sit on top face
        for (let i = 0; i < BLADES_PER_BLOCK; i++) {
          const jx = Math.random();
          const jz = Math.random();
          const wx = cx * CHUNK_W + lx + jx;
          const wz = cz * CHUNK_W + lz + jz;
          const yaw = Math.random() * Math.PI * 2;
          // Per-blade height variation: mostly 0.7–1.1, occasional tall blade up to 1.6.
          const roll = Math.random();
          const scaleY = roll < 0.08 ? 1.2 + Math.random() * 0.4 : 0.7 + Math.random() * 0.4;
          const scaleXZ = 0.85 + Math.random() * 0.35;
          positions.push([wx, worldBaseY, wz, yaw, scaleY, scaleXZ]);
        }
      }
    }

    if (positions.length === 0) return;

    const mesh = new THREE.InstancedMesh(this.bladeGeometry, this.material, positions.length);
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = this.visible;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const euler = new THREE.Euler();
    for (let i = 0; i < positions.length; i++) {
      const [wx, wy, wz, yaw, sy, sxz] = positions[i];
      // Small forward tilt so blades aren't perfectly vertical.
      const tilt = (Math.random() - 0.5) * 0.25;
      euler.set(tilt, yaw, 0, 'YXZ');
      q.setFromEuler(euler);
      s.set(sxz, sy, sxz);
      p.set(wx, wy, wz);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    this.chunkMeshes.set(key, mesh);
    this.scene.add(mesh);
  }

  public removeChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const mesh = this.chunkMeshes.get(key);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.dispose();
    this.chunkMeshes.delete(key);
  }

  public rebuildChunk(cx: number, cz: number): void {
    this.removeChunk(cx, cz);
    this.addChunk(cx, cz);
  }

  private createMaterial(): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({
      side: THREE.DoubleSide,
      color: 0xffffff,
    });
    const uniforms = this.uniforms;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uWindDir = uniforms.uWindDir;
      shader.uniforms.uWindStrength = uniforms.uWindStrength;
      shader.uniforms.uWindFreq = uniforms.uWindFreq;
      shader.uniforms.uSunDir = uniforms.uSunDir;
      shader.uniforms.uBaseColor = uniforms.uBaseColor;
      shader.uniforms.uMidColor = uniforms.uMidColor;
      shader.uniforms.uTipColor = uniforms.uTipColor;
      shader.uniforms.uBacklightColor = uniforms.uBacklightColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindFreq;
varying float vHeight;
varying vec3 vWorldPos;

// Cheap 2D hash noise for wind field. Not full perlin, but enough texture.
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
// BotW-style forward tip curve in blade-local space. Stays local so Three's
// default instance-transform path picks it up without double-application.
transformed.z += uv.y * uv.y * 0.18;
vHeight = uv.y;
`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
// Wind sway applied AFTER project_vertex so we don't fight Three's own
// instanceMatrix handling. Sample noise at the blade's world XZ, push
// mvPosition + gl_Position in world space.
mat4 gWorldMat = modelMatrix * instanceMatrix;
vec4 gWorldPos = gWorldMat * vec4(transformed, 1.0);
vec2 gFlow = gWorldPos.xz * uWindFreq + uTime * 0.6 * uWindDir;
float gNX = noise2d(gFlow) * 2.0 - 1.0;
float gNZ = noise2d(gFlow + vec2(37.7, 19.3)) * 2.0 - 1.0;
float gSway = uv.y * uv.y * uWindStrength;
vec3 gSwayWorld = vec3(gNX * gSway, 0.0, gNZ * gSway);
mvPosition.xyz += (viewMatrix * vec4(gSwayWorld, 0.0)).xyz;
gl_Position = projectionMatrix * mvPosition;
vWorldPos = gWorldPos.xyz + gSwayWorld;
`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uSunDir;
uniform vec3 uBaseColor;
uniform vec3 uMidColor;
uniform vec3 uTipColor;
uniform vec3 uBacklightColor;
varying float vHeight;
varying vec3 vWorldPos;
`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
// Vertical two-tone gradient: base → mid → tip.
vec3 lowCol = mix(uBaseColor, uMidColor, smoothstep(0.0, 0.55, vHeight));
vec3 grassCol = mix(lowCol, uTipColor, smoothstep(0.55, 1.0, vHeight));

// Per-blade color variation via world-space hashing so neighbouring blades differ.
float tint = fract(sin(dot(floor(vWorldPos.xz * 1.3), vec2(12.9898, 78.233))) * 43758.5453);
grassCol *= 0.88 + tint * 0.24;

// Fake backlight / SSS: when the camera is looking into the sun through a
// blade, warm the tip a bit.
vec3 viewDir = normalize(cameraPosition - vWorldPos);
float sunFacing = max(0.0, -dot(viewDir, normalize(uSunDir)));
float backlight = pow(sunFacing, 2.0) * smoothstep(0.4, 1.0, vHeight);
grassCol += uBacklightColor * backlight * 0.6;

diffuseColor.rgb = grassCol;
`,
        );
    };

    return material;
  }
}
