import * as THREE from '../../vendor/three.module.js';
import { pieceColor } from '../engine.js';
import { applyEnvironment, createBoard, createDust, createTable, setupLighting } from './board.js';
import { BoardHighlights } from './highlights.js';
import { createPieceAssets, createPieceVisual, setCrownVisible } from './pieces.js';
import {
  BOARD_TOP,
  FRAME_TOP,
  PIECE_BASE_Y,
  cellToWorld,
  clamp,
  easeInOutCubic,
  easeOutBack,
} from './utils.js';

const CAMERA_TARGET = new THREE.Vector3(0, 0.16, 0);
const CAMERA_DIRECTION = new THREE.Vector3(0, 1.45, 1.03).normalize();
// Portrait screens need a little more elevation so the square board fills
// more of the available height without growing wider than the viewport.
const PORTRAIT_CAMERA_DIRECTION = new THREE.Vector3(0, 2.246, 1).normalize();
const BOARD_BOUNDS = 4.92;

export class CheckersScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0705);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 130);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The board and lights are static. Only refresh the shadow map while a
    // piece is selected, moving or being promoted.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x0b0705, 1);

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.tweens = [];
    this.animationEpoch = 0;
    this._shadowsDirty = true;

    this.pieces = new Map();
    this.piecePickList = [];
    this.selectableSet = new Set();
    this.selectedIndex = null;

    this.parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.baseCameraPos = new THREE.Vector3();
    this.baseDistance = 20;

    this._resizeRenderer();
    applyEnvironment(this.scene, this.renderer);
    createTable(this.scene, this.renderer);
    const boardData = createBoard(this.renderer);
    this.boardGroup = boardData.group;
    this.scene.add(this.boardGroup);
    this.squarePickList = boardData.squareMeshes;
    setupLighting(this.scene, this.renderer);
    this.dust = createDust(this.scene);

    this.highlights = new BoardHighlights(this.scene);
    this.pieceAssets = createPieceAssets(this.renderer);

    this._onResize = () => {
      this._resizeRenderer();
      this._fitCamera();
    };
    this._onPointerMove = (event) => {
      if (event.pointerType === 'touch' || this.reducedMotion) return;
      this.parallax.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      this.parallax.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.visualViewport?.addEventListener('resize', this._onResize);

    this._frame = this._frame.bind(this);
    this._fitCamera();
    this.clock.start();
    this.renderer.setAnimationLoop(this._frame);
  }

  _resizeRenderer() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const maxDpr = coarse ? 1.6 : 1.8;
    // Cap the total render target too, so high-DPI desktops do not push
    // millions of extra pixels every frame for very little visual gain.
    const maxPixels = coarse ? 2_400_000 : 4_200_000;
    const pixelBudgetDpr = Math.sqrt(maxPixels / Math.max(1, width * height));
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr, pixelBudgetDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  _fitCamera() {
    if (!this.camera.aspect) return;
    const aspect = this.camera.aspect;
    const narrow = aspect < 0.82;
    const direction = narrow ? PORTRAIT_CAMERA_DIRECTION : CAMERA_DIRECTION;
    const xLimit = narrow ? 0.915 : 0.86;
    const topLimit = narrow ? 0.8 : 0.8;
    const bottomLimit = narrow ? -0.71 : -0.715;

    const corners = [];
    for (const x of [-BOARD_BOUNDS, BOARD_BOUNDS]) {
      for (const z of [-BOARD_BOUNDS, BOARD_BOUNDS]) {
        for (const y of [0, FRAME_TOP + 0.02]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }

    const fits = (distance) => {
      this.camera.position.copy(CAMERA_TARGET).addScaledVector(direction, distance);
      this.camera.lookAt(CAMERA_TARGET);
      this.camera.updateMatrixWorld();
      this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
      for (const corner of corners) {
        const projected = corner.clone().project(this.camera);
        if (Math.abs(projected.x) > xLimit) return false;
        if (projected.y > topLimit || projected.y < bottomLimit) return false;
      }
      return true;
    };

    let low = 6;
    let high = 90;
    let best = high;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) {
        best = mid;
        high = mid;
      } else {
        low = mid;
      }
    }

    this.baseDistance = best * 1.012;
    this.baseCameraPos.copy(CAMERA_TARGET).addScaledVector(direction, this.baseDistance);
    this.camera.position.copy(this.baseCameraPos);
    this.camera.lookAt(CAMERA_TARGET);
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this._updateTweens();
    this._updatePieces(dt);
    this.highlights.update(this.elapsed);

    if (!this.reducedMotion) {
      this.parallax.x += (this.parallax.targetX - this.parallax.x) * Math.min(1, dt * 3.2);
      this.parallax.y += (this.parallax.targetY - this.parallax.y) * Math.min(1, dt * 3.2);
      const idleX = Math.sin(this.elapsed * 0.13) * 0.035;
      const idleZ = Math.cos(this.elapsed * 0.1) * 0.022;
      this.camera.position.set(
        this.baseCameraPos.x + this.parallax.x * 0.16 + idleX,
        this.baseCameraPos.y + this.parallax.y * 0.035,
        this.baseCameraPos.z + this.parallax.y * 0.09 + idleZ,
      );
      this.camera.lookAt(CAMERA_TARGET);
    }

    this.dust.rotation.y += dt * 0.012;
    this.dust.position.y = Math.sin(this.elapsed * 0.18) * 0.07;

    if (this.tweens.length || this._shadowsDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this._shadowsDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
  }

  _updatePieces(dt) {
    const ease = 1 - Math.exp(-dt * 14);
    for (const handle of this.pieces.values()) {
      const delta = handle.liftTarget - handle.lift;
      if (Math.abs(delta) > 0.0001) {
        handle.lift += delta * ease;
        this._shadowsDirty = true;
      } else if (handle.lift !== handle.liftTarget) {
        handle.lift = handle.liftTarget;
        this._shadowsDirty = true;
      }
      handle.group.position.set(
        handle.x,
        PIECE_BASE_Y + handle.lift + handle.arcOffset,
        handle.z,
      );
      handle.group.scale.setScalar(handle.scale);
      handle.shadow.position.set(handle.x, BOARD_TOP + 0.003, handle.z);
      handle.shadow.scale.setScalar(handle.scale);
      handle.shadow.visible = handle.scale > 0.03;
    }
  }

  _addTween(duration, update, { delay = 0, ease = null } = {}) {
    return new Promise((resolve) => {
      this.tweens.push({
        durationMs: duration * 1000,
        startAt: performance.now() + delay * 1000,
        update,
        ease,
        resolve,
        done: false,
      });
      this._shadowsDirty = true;
    });
  }

  _updateTweens() {
    if (!this.tweens.length) return;
    const now = performance.now();
    const finished = [];
    for (const tween of this.tweens) {
      if (tween.done) continue;
      const elapsed = now - tween.startAt;
      if (elapsed < 0) continue;
      const t = clamp(elapsed / tween.durationMs, 0, 1);
      const eased = tween.ease ? tween.ease(t) : t;
      tween.update(eased, t);
      if (t >= 1) {
        tween.done = true;
        tween.resolve(true);
        finished.push(tween);
      }
    }
    if (finished.length) this.tweens = this.tweens.filter((tween) => !tween.done);
  }

  _cancelTweens() {
    const pending = this.tweens;
    this.tweens = [];
    for (const tween of pending) {
      tween.done = true;
      tween.resolve(false);
    }
  }

  _placeHandle(handle, index) {
    const { x, z } = cellToWorld(index);
    handle.cell = index;
    handle.disc.userData.cell = index;
    handle.x = x;
    handle.z = z;
    handle.group.position.set(x, PIECE_BASE_Y + handle.lift, z);
    handle.shadow.position.set(x, BOARD_TOP + 0.003, z);
  }

  _addPiece(index, piece) {
    const handle = createPieceVisual(this.pieceAssets, index, piece);
    handle.group.name = `piece-${index}`;
    this._placeHandle(handle, index);
    this.scene.add(handle.group);
    this.scene.add(handle.shadow);
    this.pieces.set(index, handle);
  }

  _removePieceHandle(index, handle = null) {
    const target = handle || this.pieces.get(index);
    if (!target) return;
    this.scene.remove(target.group);
    this.scene.remove(target.shadow);
  }

  _rebuildPickList() {
    this.piecePickList = [];
    for (const handle of this.pieces.values()) this.piecePickList.push(handle.disc);
  }

  syncBoard(board) {
    this.animationEpoch += 1;
    this._cancelTweens();
    this._shadowsDirty = true;
    for (const handle of this.pieces.values()) {
      this.scene.remove(handle.group);
      this.scene.remove(handle.shadow);
    }
    this.pieces.clear();
    this.selectedIndex = null;
    this.highlights.setSelection(null);
    this.highlights.setDestinations([]);
    this.highlights.setHint(null);
    this.highlights.setHover(null);
    for (let index = 0; index < board.length; index += 1) {
      if (pieceColor(board[index])) this._addPiece(index, board[index]);
    }
    this._rebuildPickList();
  }

  setSelectable(indexes) {
    this.selectableSet = new Set(indexes);
  }

  setSelection(index) {
    const previous = this.selectedIndex !== null ? this.pieces.get(this.selectedIndex) : null;
    if (previous && previous.cell !== index) previous.liftTarget = 0;
    this.selectedIndex = index;
    const handle = index === null || index === undefined ? null : this.pieces.get(index);
    if (handle) {
      handle.liftTarget = 0.062;
      this.highlights.setSelection(index);
    } else {
      this.highlights.setSelection(null);
    }
  }

  clearSelection() {
    this.setSelection(null);
  }

  setDestinations(destinations) {
    this.highlights.setDestinations(destinations || []);
  }

  setHint(hint) {
    this.highlights.setHint(hint || null);
  }

  setHover(index) {
    this.highlights.setHover(index);
  }

  setLastMove(move) {
    this.highlights.setLastMove(move || null);
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const pieceHits = this.raycaster.intersectObjects(this.piecePickList, false);
    if (pieceHits.length) {
      return { type: 'piece', index: pieceHits[0].object.userData.cell };
    }
    const squareHits = this.raycaster.intersectObjects(this.squarePickList, false);
    if (squareHits.length) {
      return { type: 'square', index: squareHits[0].object.userData.squareIndex };
    }
    return null;
  }

  _clearSelectionLift(except = null) {
    for (const handle of this.pieces.values()) {
      if (handle.cell !== except) handle.liftTarget = 0;
    }
  }

  async _revealCrown(cell) {
    const handle = this.pieces.get(cell);
    if (!handle) return;
    const epoch = this.animationEpoch;
    setCrownVisible(handle, true, 0.001);
    handle.crown.rotation.y = -0.3;

    const burstMaterial = new THREE.MeshBasicMaterial({
      color: 0xd23a3f,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const burstGeometry = new THREE.RingGeometry(0.18, 0.22, 64);
    burstGeometry.rotateX(-Math.PI / 2);
    const burst = new THREE.Mesh(burstGeometry, burstMaterial);
    const world = cellToWorld(cell);
    burst.position.set(world.x, BOARD_TOP + 0.03, world.z);
    this.scene.add(burst);

    await this._addTween(
      0.52,
      (eased) => {
        const scale = Math.max(0.001, easeOutBack(eased));
        handle.crown.scale.setScalar(scale);
        handle.crown.rotation.y = -0.3 + eased * 0.3;
        burst.scale.setScalar(0.7 + eased * 4.2);
        burst.position.y = BOARD_TOP + 0.03 + eased * 0.45;
        burstMaterial.opacity = 0.5 * (1 - eased);
      },
      { ease: (t) => t },
    ).catch(() => {});

    this.scene.remove(burst);
    burstGeometry.dispose();
    burstMaterial.dispose();
    if (this.animationEpoch === epoch) {
      handle.crown.scale.setScalar(1);
      handle.crown.rotation.y = 0;
    }
  }

  async animateStep(step, hooks = {}) {
    const { from, to, capture = null, promoted = false } = step;
    const handle = this.pieces.get(from);
    if (!handle) return null;

    const epoch = this.animationEpoch;
    const startX = handle.x;
    const startZ = handle.z;
    const target = cellToWorld(to);
    const captureHandle = capture !== null ? this.pieces.get(capture) : null;
    handle.liftTarget = 0;
    hooks.onStepStart?.(step);

    await this._addTween(
      0.36,
      (eased, raw) => {
        handle.x = THREE.MathUtils.lerp(startX, target.x, eased);
        handle.z = THREE.MathUtils.lerp(startZ, target.z, eased);
        handle.arcOffset = Math.sin(Math.PI * raw) * 0.19;
        handle.group.rotation.y = Math.sin(Math.PI * raw) * 0.055;
        if (captureHandle) {
          const captureProgress = clamp((raw - 0.3) / 0.7, 0, 1);
          captureHandle.scale = 1 - captureProgress * 0.97;
          captureHandle.arcOffset = -captureProgress * 0.08;
          captureHandle.group.rotation.y = captureProgress * 0.9;
        }
      },
      { ease: easeInOutCubic },
    );

    if (this.animationEpoch !== epoch) return handle;

    handle.x = target.x;
    handle.z = target.z;
    handle.arcOffset = 0;
    handle.group.rotation.y = 0;
    this.pieces.delete(from);
    if (captureHandle) {
      this.pieces.delete(capture);
      this._removePieceHandle(capture, captureHandle);
    }
    handle.cell = to;
    handle.disc.userData.cell = to;
    this.pieces.set(to, handle);
    this._rebuildPickList();

    if (promoted) {
      await this._revealCrown(to);
      if (this.animationEpoch !== epoch) return handle;
    }

    hooks.onStepEnd?.(step);
    return handle;
  }

  async animateMove(move, hooks = {}) {
    const epoch = this.animationEpoch;
    const segments = move.segments || [];
    for (let i = 0; i < segments.length; i += 1) {
      if (this.animationEpoch !== epoch) break;
      const segment = segments[i];
      hooks.onSegmentStart?.(segment, i);
      await this.animateStep(segment, hooks);
      if (this.animationEpoch !== epoch) break;
    }
  }

  cancelAnimations() {
    this.animationEpoch += 1;
    this._cancelTweens();
    this._shadowsDirty = true;
  }

  worldPoint(index) {
    const { x, z } = cellToWorld(index);
    return new THREE.Vector3(x, BOARD_TOP, z);
  }
}
