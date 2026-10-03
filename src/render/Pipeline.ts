import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Environment } from '../world/Environment';

/**
 * Cinematic grade applied after tone mapping (sRGB): a touch more saturation
 * and contrast, warm highlights / cooler shadows, and a soft vignette.
 */
const GradeShader = {
  name: 'GradeShader',
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.1);
      c = (c - 0.5) * 1.06 + 0.5;
      c += mix(vec3(-0.012, -0.002, 0.018), vec3(0.025, 0.012, -0.02), smoothstep(0.2, 0.8, l));
      float d = distance(vUv, vec2(0.5));
      c *= mix(1.0, 0.8, smoothstep(0.42, 0.95, d));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Draws the far background (sky + mountains, long far plane) and then the
 * town on top. On high quality this runs through a multisampled HDR composer
 * with bloom, tone mapping and colour grading; on phones it renders straight
 * to the screen.
 */
export class Pipeline {
  private readonly composer: EffectComposer | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly env: Environment,
    postFX: boolean,
  ) {
    renderer.autoClear = false;
    if (!postFX) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(env.bgScene, env.bgCamera));
    const main = new RenderPass(scene, camera);
    main.clear = false;
    main.clearDepth = true;
    composer.addPass(main);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.14, 0.5, 1.1));
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    this.composer = composer;
  }

  setSize(w: number, h: number): void {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  render(): void {
    if (this.composer) {
      this.composer.render();
      return;
    }
    const r = this.renderer;
    r.clear();
    r.render(this.env.bgScene, this.env.bgCamera);
    r.clearDepth();
    r.render(this.scene, this.camera);
  }
}
