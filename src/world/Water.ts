import * as THREE from 'three';

/** Shared clock for every animated surface (water, grass, leaves). */
export const waterTime = { value: 0 };

/** Same sun as Environment (late afternoon, south-west). */
const SUN = new THREE.Vector3(-0.55, 0.42, 0.62).normalize();

const vertexShader = /* glsl */ `
  attribute float aDepth;
  varying vec3 vWorld;
  varying float vDepth;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vDepth = aDepth;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uTime;
  uniform float uFlow;
  uniform float uOpacity;
  uniform vec2 uFlowDir;
  varying vec3 vWorld;
  varying float vDepth;
  #include <common>
  #include <fog_pars_fragment>

  // Sum of travelling waves; returns the surface slope (dh/dx, dh/dz).
  vec2 slope(vec2 p, float t) {
    vec2 s = vec2(0.0);
    vec2 q = p - uFlowDir * t * uFlow;
    s += vec2(cos(q.x * 0.9 + q.y * 0.3), 0.0) * 0.035;
    s += vec2(0.0, cos(q.y * 1.1 - q.x * 0.25)) * 0.03;
    s += vec2(cos(dot(q, vec2(2.1, 1.6)) + t * 1.1)) * 0.014 * vec2(2.1, 1.6) / 2.6;
    s += vec2(cos(dot(q, vec2(-3.3, 4.1)) - t * 1.5)) * 0.008 * vec2(-3.3, 4.1) / 5.3;
    return s;
  }

  void main() {
    vec2 sl = slope(vWorld.xz, uTime);
    vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 r = reflect(-v, n);
    float fres = 0.02 + 0.6 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(r.y, 0.0, 1.0), 0.6));
    float spec = pow(max(dot(r, uSunDir), 0.0), 90.0) * 1.6 + pow(max(dot(r, uSunDir), 0.0), 12.0) * 0.12;
    float depthK = 1.0 - exp(-vDepth * 1.3);
    vec3 body = mix(uShallow, uDeep, depthK);
    vec3 col = mix(body, sky, fres) + uSunColor * spec;
    // Foam where the water thins out against the banks and stones.
    float foam = (1.0 - smoothstep(0.02, 0.18, vDepth)) * (0.55 + 0.45 * sin(vWorld.x * 3.1 + vWorld.z * 2.7 + uTime * 2.0));
    col = mix(col, vec3(0.85, 0.88, 0.86), clamp(foam, 0.0, 1.0) * 0.5);
    float alpha = mix(0.28, uOpacity, depthK) + fres * 0.35 + foam * 0.3;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Physically inspired water: Fresnel sky reflection and sun glint on a
 * moving wave surface, colour and transparency from the real depth of the
 * channel (`aDepth`), so the riverbed shows through near the banks.
 */
export function createWaterMaterial(
  deep: THREE.ColorRepresentation, shallow: THREE.ColorRepresentation, flow: number, opacity = 0.92,
): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uDeep: { value: new THREE.Color(deep) },
      uShallow: { value: new THREE.Color(shallow) },
      uSkyTop: { value: new THREE.Color('#2f5f96') },
      uSkyHorizon: { value: new THREE.Color('#8fa9bb') },
      uSunDir: { value: SUN },
      uSunColor: { value: new THREE.Color('#ffe0b0') },
      uFlow: { value: flow },
      uFlowDir: { value: new THREE.Vector2(0.3, -1).normalize() },
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
