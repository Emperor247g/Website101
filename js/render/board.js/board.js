import * as THREE from '../../vendor/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import {
  BOARD_TOP,
  FRAME_TOP,
  WOOD_PALETTES,
  createCircleTexture,
  createEnvironment,
  createPlaqueTexture,
  createRadialTexture,
  createWoodMaps,
  createWoodMaterial,
  canvasTexture,
  makeTextStrip,
} from './utils.js';

export function createTable(scene, renderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const { canvas, bumpCanvas } = createWoodMaps({
    seed: 9182,
    palette: WOOD_PALETTES.table,
    size: 1024,
    knots: 3,
    bumpStrength: 2.1,
  });
  const map = canvasTexture(canvas, { srgb: true, anisotropy });
  const bumpMap = canvasTexture(bumpCanvas, { srgb: false, anisotropy });
  map.repeat.set(5, 5);
  bumpMap.repeat.set(5, 5);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    bumpMap,
    bumpScale: 0.09,
    roughness: 0.79,
    metalness: 0,
    envMapIntensity: 0.22,
  });

  const table = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), material);
  table.rotation.x = -Math.PI / 2;
  table.position.y = 0;
  table.receiveShadow = true;
  scene.add(table);

  // A soft pool of contact shade beneath the board.
  const contactMap = createRadialTexture(256, [
    [0, 'rgba(0,0,0,.9)'],
    [0.55, 'rgba(0,0,0,.62)'],
    [0.8, 'rgba(0,0,0,.22)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(13.2, 13.2),
    new THREE.MeshBasicMaterial({
      map: contactMap,
      color: 0x000000,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.006;
  scene.add(contact);

  return table;
}

export function createBoard(renderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const group = new THREE.Group();
  group.name = 'checkers-board';

  const baseMaterial = createWoodMaterial({
    seed: 142,
    palette: WOOD_PALETTES.darkWalnut,
    size: 1024,
    knots: 2,
    bumpScale: 0.035,
    roughness: 0.46,
    clearcoat: 0.3,
    envMapIntensity: 0.7,
    anisotropy,
  });
  const frameMaterials = [
    createWoodMaterial({
      seed: 771,
      palette: WOOD_PALETTES.walnut,
      size: 512,
      knots: 1,
      bumpScale: 0.02,
      roughness: 0.42,
      clearcoat: 0.28,
      envMapIntensity: 0.72,
      anisotropy,
    }),
    createWoodMaterial({
      seed: 1192,
      palette: WOOD_PALETTES.walnut,
      size: 512,
      knots: 0,
      bumpScale: 0.02,
      roughness: 0.48,
      clearcoat: 0.22,
      envMapIntensity: 0.65,
      anisotropy,
    }),
  ];

  const lightMaterials = [];
  const darkMaterials = [];
  for (let i = 0; i < 4; i += 1) {
    lightMaterials.push(
      createWoodMaterial({
        seed: 301 + i * 97,
        palette: WOOD_PALETTES.oak,
        size: 512,
        knots: i === 2 ? 1 : 0,
        bumpScale: 0.018,
        roughness: 0.5,
        clearcoat: 0.18,
        envMapIntensity: 0.55,
        anisotropy,
      }),
    );
    darkMaterials.push(
      createWoodMaterial({
        seed: 701 + i * 131,
        palette: WOOD_PALETTES.walnut,
        size: 512,
        knots: i === 1 ? 1 : 0,
        bumpScale: 0.018,
        roughness: 0.47,
        clearcoat: 0.22,
        envMapIntensity: 0.6,
        anisotropy,
      }),
    );
  }

  const base = new THREE.Mesh(
    new RoundedBoxGeometry(9.72, 0.32, 9.72, 3, 0.14),
    baseMaterial,
  );
  base.position.y = 0.17;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const squareGeometry = new RoundedBoxGeometry(0.988, 0.045, 0.988, 1, 0.008);
  const squareMeshes = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const index = row * 8 + col;
      const light = (row + col) % 2 === 0;
      const palette = light ? lightMaterials : darkMaterials;
      const material = palette[(row * 7 + col * 5 + (light ? 1 : 3)) % palette.length];
      const square = new THREE.Mesh(squareGeometry, material);
      square.position.set(col - 3.5, 0.345, row - 3.5);
      square.receiveShadow = true;
      square.userData.squareIndex = index;
      group.add(square);
      squareMeshes.push(square);
    }
  }

  const frameSlats = [
    { size: [9.58, 0.23, 0.78], position: [0, 0.445, -4.42], texture: 0 },
    { size: [9.58, 0.23, 0.78], position: [0, 0.445, 4.42], texture: 1 },
    { size: [0.78, 0.23, 8.06], position: [-4.42, 0.445, 0], texture: 0 },
    { size: [0.78, 0.23, 8.06], position: [4.42, 0.445, 0], texture: 1 },
  ];

  for (const slat of frameSlats) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(slat.size[0], slat.size[1], slat.size[2], 2, 0.035),
      frameMaterials[slat.texture],
    );
    mesh.position.set(...slat.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Fine brass inlay around the playing field.
  const brass = new THREE.MeshStandardMaterial({
    color: 0x9b7848,
    metalness: 0.84,
    roughness: 0.3,
    envMapIntensity: 1.05,
  });
  const inlayGeometryH = new THREE.BoxGeometry(8.08, 0.008, 0.012);
  const inlayGeometryV = new THREE.BoxGeometry(0.012, 0.008, 8.08);
  for (const z of [-4.025, 4.025]) {
    const line = new THREE.Mesh(inlayGeometryH, brass);
    line.position.set(0, FRAME_TOP - 0.002, z);
    line.castShadow = false;
    group.add(line);
  }
  for (const x of [-4.025, 4.025]) {
    const line = new THREE.Mesh(inlayGeometryV, brass);
    line.position.set(x, FRAME_TOP - 0.002, 0);
    line.castShadow = false;
    group.add(line);
  }

  // Four small brass corner pins.
  const pinGeometry = new THREE.SphereGeometry(0.035, 18, 12);
  for (const x of [-4.56, 4.56]) {
    for (const z of [-4.56, 4.56]) {
      const pin = new THREE.Mesh(pinGeometry, brass);
      pin.position.set(x, FRAME_TOP + 0.008, z);
      pin.scale.y = 0.42;
      pin.castShadow = true;
      group.add(pin);
    }
  }

  const labelMaterialOptions = {
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    toneMapped: false,
  };

  const lettersTexture = makeTextStrip('letters');
  const numbersTexture = makeTextStrip('numbers');
  const lettersMaterial = new THREE.MeshBasicMaterial({ map: lettersTexture, ...labelMaterialOptions });
  const numbersMaterial = new THREE.MeshBasicMaterial({ map: numbersTexture, ...labelMaterialOptions });

  for (const z of [-4.42, 4.42]) {
    const labels = new THREE.Mesh(new THREE.PlaneGeometry(8.13, 0.54), lettersMaterial);
    labels.rotation.x = -Math.PI / 2;
    labels.position.set(0, FRAME_TOP + 0.006, z);
    labels.renderOrder = 3;
    group.add(labels);
  }
  for (const x of [-4.42, 4.42]) {
    const labels = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 8.13), numbersMaterial);
    labels.rotation.x = -Math.PI / 2;
    labels.position.set(x, FRAME_TOP + 0.006, 0);
    labels.renderOrder = 3;
    group.add(labels);
  }

  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(1.04, 0.216),
    new THREE.MeshBasicMaterial({
      map: createPlaqueTexture(),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  plaque.position.set(0, 0.205, 4.862);
  plaque.renderOrder = 4;
  group.add(plaque);

  base.castShadow = true;
  return { group, squareMeshes, base, lightMaterials, darkMaterials };
}

export function setupLighting(scene, renderer) {
  const mobile = window.innerWidth < 760 || renderer.domElement.width < 800;

  const hemi = new THREE.HemisphereLight(0xffdfb8, 0x170d08, 0.72);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x6e452c, 0.28);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffd9ae, 3.15);
  key.position.set(-4.8, 10.5, 6.2);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.camera.left = -7.4;
  key.shadow.camera.right = 7.4;
  key.shadow.camera.top = 7.4;
  key.shadow.camera.bottom = -7.4;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 26;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 3.5;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0x91a9c4, 0.72);
  fill.position.set(7, 6, -7);
  scene.add(fill);

  const warmPool = new THREE.SpotLight(0xffb169, 90, 28, Math.PI / 4.1, 0.85, 1.55);
  warmPool.position.set(3.5, 12, 8);
  warmPool.target.position.set(0, 0.3, 0);
  scene.add(warmPool);
  scene.add(warmPool.target);

  const ricochet = new THREE.PointLight(0xff9f60, 9, 18, 2);
  ricochet.position.set(-7, 2.8, 4);
  scene.add(ricochet);

  return { hemi, ambient, key, fill, warmPool, ricochet };
}

export function createDust(scene) {
  const count = window.innerWidth < 760 ? 38 : 74;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 17;
    positions[i * 3 + 1] = 0.6 + Math.random() * 6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: createCircleTexture('rgba(255,229,190,.8)', 'rgba(255,229,190,0)'),
    color: 0xffd8a7,
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return points;
}

export function applyEnvironment(scene, renderer) {
  scene.environment = createEnvironment(renderer);
  scene.fog = new THREE.FogExp2(0x0b0604, 0.013);
}
