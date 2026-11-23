import * as THREE from '../../vendor/three.module.js';
import { isKing, pieceColor, WHITE } from '../engine.js';
import { createCircleTexture, createCrownShape } from './utils.js';

const PIECE_RADIUS = 0.36;
const PIECE_HEIGHT = 0.176;

function createDiscGeometry() {
  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.292, 0),
    new THREE.Vector2(0.326, 0.007),
    new THREE.Vector2(0.348, 0.024),
    new THREE.Vector2(0.359, 0.052),
    new THREE.Vector2(0.36, 0.09),
    new THREE.Vector2(0.354, 0.124),
    new THREE.Vector2(0.336, 0.15),
    new THREE.Vector2(0.302, 0.166),
    new THREE.Vector2(0.258, 0.174),
    new THREE.Vector2(0.205, 0.176),
    new THREE.Vector2(0, 0.176),
  ];
  return new THREE.LatheGeometry(profile, 80);
}

function createCrownGroup(materials) {
  const group = new THREE.Group();
  group.name = 'red-crown';

  const geometry = new THREE.ExtrudeGeometry(createCrownShape(), {
    depth: 0.04,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.007,
    bevelThickness: 0.007,
    curveSegments: 8,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();

  const crown = new THREE.Mesh(geometry, materials.crown);
  crown.castShadow = true;
  crown.receiveShadow = true;
  group.add(crown);

  // Little rounded points reinforce the three-dimensional crown silhouette.
  const peakGeometry = new THREE.SphereGeometry(0.0125, 12, 8);
  const peaks = [
    [-0.228, 0.012],
    [-0.078, 0.108],
    [0, 0.155],
    [0.078, 0.108],
    [0.228, 0.012],
  ];
  for (const [x, y] of peaks) {
    const point = new THREE.Mesh(peakGeometry, materials.crownHighlight);
    point.position.set(x, 0.048, -y);
    point.castShadow = true;
    group.add(point);
  }

  // A tiny polished gold jewel sits in the band.
  const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 10), materials.jewel);
  jewel.scale.set(1, 0.62, 1);
  jewel.position.set(0, 0.044, 0.075);
  jewel.castShadow = true;
  group.add(jewel);

  group.position.y = PIECE_HEIGHT + 0.002;
  return group;
}

export function createPieceAssets(renderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const discGeometry = createDiscGeometry();
  const shadowTexture = createCircleTexture('rgba(0,0,0,.9)', 'rgba(0,0,0,0)');
  shadowTexture.anisotropy = anisotropy;

  const whiteMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf1e9dd,
    roughness: 0.17,
    metalness: 0.015,
    clearcoat: 1,
    clearcoatRoughness: 0.055,
    envMapIntensity: 1.25,
  });
  const blackMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x171311,
    roughness: 0.13,
    metalness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    envMapIntensity: 1.35,
  });

  const whiteGrooveMaterial = new THREE.MeshStandardMaterial({
    color: 0x8d8172,
    roughness: 0.64,
    metalness: 0.05,
    envMapIntensity: 0.25,
  });
  const blackGrooveMaterial = new THREE.MeshStandardMaterial({
    color: 0x030202,
    roughness: 0.58,
    metalness: 0.1,
    envMapIntensity: 0.2,
  });

  const crownMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x9f1728,
    roughness: 0.23,
    metalness: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.11,
    emissive: 0x260207,
    emissiveIntensity: 0.28,
    envMapIntensity: 1.35,
  });
  const crownHighlightMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc42c36,
    roughness: 0.17,
    metalness: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    emissive: 0x2f0308,
    emissiveIntensity: 0.2,
    envMapIntensity: 1.5,
  });
  const jewelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd0a456,
    roughness: 0.18,
    metalness: 0.95,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.5,
  });

  const ringGeometries = [0.075, 0.132, 0.185].map(
    (radius) => new THREE.RingGeometry(radius, radius + 0.011, 72),
  );
  for (const geometry of ringGeometries) geometry.rotateX(-Math.PI / 2);

  const shadowGeometry = new THREE.PlaneGeometry(0.91, 0.91);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    color: 0x000000,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    toneMapped: false,
  });

  return {
    discGeometry,
    ringGeometries,
    shadowGeometry,
    shadowMaterial,
    materials: {
      white: whiteMaterial,
      black: blackMaterial,
      whiteGroove: whiteGrooveMaterial,
      blackGroove: blackGrooveMaterial,
      crown: crownMaterial,
      crownHighlight: crownHighlightMaterial,
      jewel: jewelMaterial,
    },
  };
}

export function createPieceVisual(assets, index, piece) {
  const color = pieceColor(piece);
  const white = color === WHITE;
  const group = new THREE.Group();
  group.userData.type = 'piece';

  const disc = new THREE.Mesh(
    assets.discGeometry,
    white ? assets.materials.white : assets.materials.black,
  );
  disc.castShadow = true;
  disc.receiveShadow = true;
  disc.userData.cell = index;
  disc.userData.type = 'piece';
  group.add(disc);

  const grooveMaterial = white ? assets.materials.whiteGroove : assets.materials.blackGroove;
  for (const ringGeometry of assets.ringGeometries) {
    const ring = new THREE.Mesh(ringGeometry, grooveMaterial);
    ring.position.y = PIECE_HEIGHT + 0.0007;
    ring.receiveShadow = true;
    group.add(ring);
  }

  const crown = createCrownGroup(assets.materials);
  crown.visible = isKing(piece);
  crown.scale.setScalar(isKing(piece) ? 1 : 0.001);
  group.add(crown);

  const shadow = new THREE.Mesh(assets.shadowGeometry, assets.shadowMaterial);
  shadow.renderOrder = 1;

  return {
    group,
    disc,
    crown,
    shadow,
    cell: index,
    color,
    lift: 0,
    liftTarget: 0,
    arcOffset: 0,
    scale: 1,
    offsetX: 0,
    offsetZ: 0,
  };
}

export function setCrownVisible(handle, visible, scale = null) {
  handle.crown.visible = visible;
  handle.crown.scale.setScalar(scale === null ? (visible ? 1 : 0.001) : scale);
}

export const pieceMetrics = {
  radius: PIECE_RADIUS,
  height: PIECE_HEIGHT,
};
