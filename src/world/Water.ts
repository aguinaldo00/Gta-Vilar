import * as THREE from 'three';

/** Shared clock for every water surface. */
export const waterTime = { value: 0 };

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += sin(wp.x * 0.55 + uTime * 1.3) * 0.035 + cos(wp.z * 0.42 - uTime * 1.1) * 0.035;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uTime;
  uniform float uFlow;
  uniform float uOpacity;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vWorld.xz;
    float fz = p.y - uTime * uFlow;
    float w1 = sin(p.x * 1.7 + sin(fz * 0.35) * 2.0 + uTime * 0.6);
    float w2 = sin(fz * 1.1 + sin(p.x * 0.8) * 1.5);
    float ripple = w1 * w2;
    vec3 col = mix(uDeep, uShallow, 0.5 + 0.35 * ripple);
    float glint = smoothstep(0.8, 0.98, ripple);
    col += vec3(0.85, 0.92, 1.0) * glint * 0.35;
    gl_FragColor = vec4(col, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Animated, flowing water; ripples drift along +Z at `flow` m/s. */
export function createWaterMaterial(deep: THREE.ColorRepresentation, shallow: THREE.ColorRepresentation, flow: number, opacity = 0.86): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uDeep: { value: new THREE.Color(deep) },
      uShallow: { value: new THREE.Color(shallow) },
      uFlow: { value: flow },
      uOpacity: { value: opacity },
    },
  ]);
  uniforms.uTime = waterTime;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}
