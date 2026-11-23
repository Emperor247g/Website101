import * as THREE from '../../vendor/three.module.js';
import { indexToRowCol } from '../engine.js';

export const BOARD_HALF = 4;
export const BOARD_TOP = 0.3675;
export const FRAME_TOP = 0.56;
export const PIECE_BASE_Y = BOARD_TOP + 0.002;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cellToWorld(index) {
  const [row, col] = indexToRowCol(index);
  return { x: col - 3.5, z: row - 3.5, row, col };
}

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasTexture(canvas, { srgb = true, anisotropy = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function drawWoodGrain(canvas, { seed, palette, knots = 0 }) {
  const ctx = canvas.getContext('2d');
  const random = mulberry32(seed);
  const w = canvas.width;
  const h = canvas.height;

  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, palette.base);
  gradient.addColorStop(0.42, palette.light);
  gradient.addColorStop(0.74, palette.base);
  gradient.addColorStop(1, palette.dark);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Broad, softly blended bands of colour across the plank.
  for (let i = 0; i < 22; i += 1) {
    const y = random() * h;
    const thickness = 8 + random() * 46;
    ctx.beginPath();
    ctx.moveTo(-20, y);
    for (let x = -20; x <= w + 20; x += 14) {
      const wobble = Math.sin(x * 0.009 + random() * 0.2) * (2 + random() * 5);
      ctx.lineTo(x, y + wobble);
    }
    const grad = ctx.createLinearGradient(0, y - thickness / 2, 0, y + thickness / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, i % 3 === 0 ? palette.bandLight : palette.bandDark);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = thickness;
    ctx.stroke();
  }

  // The long, fine grain lines are what make the material read as timber.
  for (let i = 0; i < 165; i += 1) {
    const y0 = random() * h;
    const amplitude = 1.2 + random() * 7;
    const frequency = 0.006 + random() * 0.021;
    const phase = random() * Math.PI * 2;
    const drift = (random() - 0.5) * 12;
    const dark = random() < 0.68;
    const alpha = 0.025 + random() * 0.095;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 5) {
      const y =
        y0 +
        drift * (x / w) +
        Math.sin(x * frequency + phase) * amplitude +
        Math.sin(x * frequency * 2.71 + phase * 1.7) * amplitude * 0.35 +
        Math.sin(x * frequency * 0.31 + phase * 0.4) * 5;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = dark
      ? `rgba(27,13,6,${alpha})`
      : `rgba(255,230,192,${alpha * 0.75})`;
    ctx.lineWidth = 0.35 + random() * 1.55;
    ctx.stroke();
  }

  // Fine pores and flecks.
  for (let i = 0; i < 620; i += 1) {
    const x = random() * w;
    const y = random() * h;
    const len = 0.8 + random() * 4.4;
    ctx.strokeStyle = `rgba(24,11,5,${0.018 + random() * 0.055})`;
    ctx.lineWidth = 0.35 + random() * 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (random() - 0.5) * 0.8);
    ctx.stroke();
  }

  if (knots > 0) {
    const knotCount = random() < 0.48 ? knots : 0;
    for (let k = 0; k < knotCount; k += 1) {
      const x = w * (0.18 + random() * 0.64);
      const y = h * (0.2 + random() * 0.6);
      const stretch = 0.55 + random() * 0.8;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((random() - 0.5) * 0.18);
      ctx.scale(stretch, 1);
      for (let r = 3; r < 28; r += 2.5) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.9, r * 0.62, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(24,10,4,${0.18 - r * 0.004})`;
        ctx.lineWidth = 0.8 + random() * 0.7;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.5, 1.7, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,8,3,.42)';
      ctx.fill();
      ctx.restore();
    }
  }

  // Organic tonal noise.
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * 7;
    data[i] = clamp(data[i] + n, 0, 255);
    data[i + 1] = clamp(data[i + 1] + n, 0, 255);
    data[i + 2] = clamp(data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
}

function makeBumpCanvas(sourceCanvas, strength = 1.7) {
  const bump = makeCanvas(sourceCanvas.width, sourceCanvas.height);
  const ctx = bump.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, bump.width, bump.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = clamp(128 + (lum - 128) * strength, 0, 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
  return bump;
}

export function createWoodMaps({ seed, palette, size = 512, knots = 0, bumpStrength = 1.7 }) {
  const canvas = makeCanvas(size, size);
  drawWoodGrain(canvas, { seed, palette, knots });
  const bumpCanvas = makeBumpCanvas(canvas, bumpStrength);
  return { canvas, bumpCanvas };
}

export function createWoodMaterial({
  seed,
  palette,
  size = 512,
  knots = 0,
  bumpScale = 0.012,
  roughness = 0.54,
  clearcoat = 0.12,
  envMapIntensity = 0.55,
  anisotropy = 1,
  color = 0xffffff,
}) {
  const { canvas, bumpCanvas } = createWoodMaps({ seed, palette, size, knots });
  const map = canvasTexture(canvas, { srgb: true, anisotropy });
  const bumpMap = canvasTexture(bumpCanvas, { srgb: false, anisotropy });
  return new THREE.MeshPhysicalMaterial({
    color,
    map,
    bumpMap,
    bumpScale,
    roughness,
    metalness: 0,
    clearcoat,
    clearcoatRoughness: 0.6,
    envMapIntensity,
  });
}

export const WOOD_PALETTES = {
  oak: {
    base: '#b98a5a',
    light: '#cda372',
    dark: '#8b5f37',
    bandLight: 'rgba(255,224,176,.14)',
    bandDark: 'rgba(82,48,22,.10)',
  },
  walnut: {
    base: '#4b2b1c',
    light: '#68402a',
    dark: '#2c160d',
    bandLight: 'rgba(230,169,110,.12)',
    bandDark: 'rgba(15,6,3,.16)',
  },
  darkWalnut: {
    base: '#382016',
    light: '#503124',
    dark: '#1d0f09',
    bandLight: 'rgba(214,157,103,.10)',
    bandDark: 'rgba(8,4,2,.18)',
  },
  table: {
    base: '#25150e',
    light: '#3b2519',
    dark: '#100906',
    bandLight: 'rgba(199,136,81,.08)',
    bandDark: 'rgba(3,1,0,.22)',
  },
};

export function createRadialTexture(size = 256, stops = null) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const fallback = [
    [0, 'rgba(255,255,255,1)'],
    [0.55, 'rgba(255,255,255,.55)'],
    [1, 'rgba(255,255,255,0)'],
  ];
  for (const [offset, color] of stops || fallback) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(canvas, { srgb: false });
}

export function createCircleTexture(inner = 'rgba(255,255,255,.95)', outer = 'rgba(255,255,255,0)') {
  const size = 128;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return canvasTexture(canvas, { srgb: false });
}

export function createEnvironment(renderer) {
  const canvas = makeCanvas(1024, 512);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#28170c');
  gradient.addColorStop(0.36, '#180d08');
  gradient.addColorStop(0.66, '#0b0604');
  gradient.addColorStop(1, '#030202');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  // Warm window/softbox highlights, softened into broad reflections.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const softboxes = [
    { x: 155, y: 110, w: 250, h: 95, color: 'rgba(255,221,170,.68)' },
    { x: 610, y: 70, w: 175, h: 65, color: 'rgba(255,195,126,.36)' },
    { x: 850, y: 145, w: 95, h: 190, color: 'rgba(156,188,214,.22)' },
    { x: 405, y: 290, w: 400, h: 30, color: 'rgba(255,147,72,.12)' },
  ];
  for (const box of softboxes) {
    ctx.shadowColor = box.color;
    ctx.shadowBlur = 55;
    const g = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, box.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 18);
    ctx.fill();
  }
  ctx.restore();

  const texture = canvasTexture(canvas, { srgb: true, anisotropy: 1 });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return envMap;
}

export function makeTextStrip(type, color = '#d7bf99') {
  const horizontal = type === 'letters';
  const canvas = makeCanvas(horizontal ? 1024 : 128, horizontal ? 128 : 1024);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${horizontal ? 600 : 600} ${horizontal ? 52 : 50}px Manrope, Segoe UI, sans-serif`;

  const labels = horizontal
    ? ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    : ['8', '7', '6', '5', '4', '3', '2', '1'];

  labels.forEach((label, index) => {
    const x = horizontal ? (index + 0.5) * (canvas.width / 8) : canvas.width / 2;
    const y = horizontal ? canvas.height / 2 : (index + 0.5) * (canvas.height / 8);
    ctx.fillStyle = 'rgba(22,10,4,.7)';
    ctx.fillText(label, x + 1.5, y + 2);
    ctx.fillStyle = 'rgba(255,241,215,.22)';
    ctx.fillText(label, x - 1, y - 1);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
  });

  return canvasTexture(canvas, { srgb: true, anisotropy: 4 });
}

export function createPlaqueTexture() {
  const canvas = makeCanvas(768, 160);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Small crown mark
  ctx.save();
  ctx.translate(70, 80);
  ctx.fillStyle = 'rgba(196,148,82,.92)';
  ctx.beginPath();
  ctx.moveTo(-25, 16);
  ctx.lineTo(-28, -12);
  ctx.lineTo(-13, -1);
  ctx.lineTo(-7, -25);
  ctx.lineTo(0, -6);
  ctx.lineTo(7, -25);
  ctx.lineTo(13, -1);
  ctx.lineTo(28, -12);
  ctx.lineTo(25, 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.font = '600 46px Manrope, Segoe UI, sans-serif';
  ctx.letterSpacing = '9px';
  ctx.fillStyle = 'rgba(22,10,4,.68)';
  ctx.fillText('CROWN & OAK', 399, 84);
  ctx.fillStyle = 'rgba(210,168,104,.92)';
  ctx.fillText('CROWN & OAK', 396, 80);
  ctx.font = '400 17px Manrope, Segoe UI, sans-serif';
  ctx.fillStyle = 'rgba(210,168,104,.52)';
  ctx.fillText('TABLETOP CHECKERS', 396, 121);
  return canvasTexture(canvas, { srgb: true, anisotropy: 4 });
}

export function createCrownShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.205, -0.092);
  shape.lineTo(-0.228, 0.012);
  shape.lineTo(-0.128, -0.032);
  shape.lineTo(-0.078, 0.108);
  shape.lineTo(-0.026, 0.018);
  shape.lineTo(0, 0.155);
  shape.lineTo(0.026, 0.018);
  shape.lineTo(0.078, 0.108);
  shape.lineTo(0.128, -0.032);
  shape.lineTo(0.228, 0.012);
  shape.lineTo(0.205, -0.092);
  shape.closePath();
  return shape;
}
