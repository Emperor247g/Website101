import * as THREE from '../../vendor/three.module.js';
import { BOARD_TOP, cellToWorld, createCircleTexture } from './utils.js';

const MARKER_Y = BOARD_TOP + 0.007;

function makeGlowMaterial(color, opacity, map) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function makeRingMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function makeRingGeometry(inner, outer, segments = 64) {
  const geometry = new THREE.RingGeometry(inner, outer, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function atCell(object, index) {
  const { x, z } = cellToWorld(index);
  object.position.set(x, MARKER_Y, z);
}

export class BoardHighlights {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'board-highlights';
    scene.add(this.root);
    this.glowTexture = createCircleTexture('rgba(255,255,255,.9)', 'rgba(255,255,255,0)');

    this.trackGroup = new THREE.Group();
    this.root.add(this.trackGroup);
    this.trackGeometry = new THREE.PlaneGeometry(0.93, 0.93);
    this.trackGeometry.rotateX(-Math.PI / 2);
    this.trackEdges = new THREE.EdgesGeometry(this.trackGeometry);
    this.trackLineMaterial = new THREE.LineBasicMaterial({
      color: 0xe7c48a,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      toneMapped: false,
    });

    this.selectionGroup = new THREE.Group();
    this.selectionGroup.visible = false;
    this.selectionRing = new THREE.Mesh(
      makeRingGeometry(0.368, 0.436),
      makeRingMaterial(0xf2c879, 0.86),
    );
    this.selectionGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 1.08).rotateX(-Math.PI / 2),
      makeGlowMaterial(0xf0b95f, 0.2, this.glowTexture),
    );
    this.selectionGlow.position.y = -0.002;
    this.selectionGroup.add(this.selectionGlow, this.selectionRing);
    this.root.add(this.selectionGroup);

    this.destinationGroup = new THREE.Group();
    this.root.add(this.destinationGroup);
    this.destinations = [];

    this.hintGroup = new THREE.Group();
    this.hintGroup.visible = false;
    this.root.add(this.hintGroup);

    this.hover = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.88).rotateX(-Math.PI / 2),
      makeGlowMaterial(0xfff1d4, 0.11, this.glowTexture),
    );
    this.hover.visible = false;
    this.root.add(this.hover);

    this.lastMove = null;
    this.pulse = 0;
  }

  setSelection(index) {
    if (index === null || index === undefined) {
      this.selectionGroup.visible = false;
      return;
    }
    atCell(this.selectionGroup, index);
    this.selectionGroup.visible = true;
  }

  setDestinations(destinations = []) {
    for (const marker of this.destinations) {
      this.destinationGroup.remove(marker.group);
      marker.group.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
    }
    this.destinations = [];

    destinations.forEach((destination, index) => {
      const group = new THREE.Group();
      const color = destination.capture ? 0xe36a5e : 0xf0cf8a;
      const ring = new THREE.Mesh(
        makeRingGeometry(0.115, 0.192, 48),
        makeRingMaterial(color, destination.capture ? 0.95 : 0.82),
      );
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.57, 0.57).rotateX(-Math.PI / 2),
        makeGlowMaterial(color, destination.capture ? 0.27 : 0.19, this.glowTexture),
      );
      glow.position.y = -0.001;
      group.add(glow, ring);
      atCell(group, destination.index);
      group.userData.phase = index * 0.82;
      group.userData.baseScale = 1;
      this.destinationGroup.add(group);
      this.destinations.push({ group, ring, glow, index });
    });
  }

  setHint(hint) {
    while (this.hintGroup.children.length) {
      const child = this.hintGroup.children.pop();
      child.traverse((node) => {
        if (node.isMesh) {
          node.geometry.dispose();
          node.material.dispose();
        }
      });
    }
    this.hintGroup.visible = false;
    if (!hint) return;

    const source = new THREE.Group();
    source.add(
      new THREE.Mesh(makeRingGeometry(0.36, 0.425), makeRingMaterial(0x9ce1d1, 0.9)),
    );
    source.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2),
        makeGlowMaterial(0x78d7c2, 0.16, this.glowTexture),
      ),
    );
    atCell(source, hint.from);
    this.hintGroup.add(source);

    const target = new THREE.Group();
    target.add(
      new THREE.Mesh(makeRingGeometry(0.12, 0.2, 48), makeRingMaterial(0x9ce1d1, 0.92)),
    );
    target.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
        makeGlowMaterial(0x78d7c2, 0.2, this.glowTexture),
      ),
    );
    atCell(target, hint.to);
    this.hintGroup.add(target);
    this.hintGroup.visible = true;
  }

  setHover(index) {
    if (index === null || index === undefined) {
      this.hover.visible = false;
      return;
    }
    atCell(this.hover, index);
    this.hover.visible = true;
  }

  setLastMove(move) {
    while (this.trackGroup.children.length) {
      this.trackGroup.remove(this.trackGroup.children[0]);
    }
    this.lastMove = move;
    if (!move) return;

    const cells = new Set([move.from, move.to]);

    for (const index of cells) {
      const { x, z } = cellToWorld(index);
      const outline = new THREE.LineSegments(this.trackEdges, this.trackLineMaterial);
      outline.position.set(x, MARKER_Y + 0.001, z);
      this.trackGroup.add(outline);
    }
  }

  update(time) {
    this.pulse = time;
    if (this.selectionGroup.visible) {
      const s = 1 + Math.sin(time * 3.4) * 0.025;
      this.selectionRing.scale.setScalar(s);
      this.selectionRing.material.opacity = 0.68 + Math.sin(time * 3.4) * 0.15;
      this.selectionGlow.material.opacity = 0.17 + Math.sin(time * 2.5) * 0.04;
    }

    for (const marker of this.destinations) {
      const wave = 0.5 + 0.5 * Math.sin(time * 3.1 + marker.group.userData.phase);
      marker.group.scale.setScalar(0.94 + wave * 0.1);
      marker.ring.material.opacity = 0.58 + wave * 0.36;
      marker.glow.material.opacity = 0.12 + wave * 0.13;
    }

    if (this.hintGroup.visible) {
      const wave = 0.5 + 0.5 * Math.sin(time * 3.7);
      this.hintGroup.scale.setScalar(0.985 + wave * 0.025);
    }
  }
}
