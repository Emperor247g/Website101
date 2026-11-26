import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicJs = resolve(root, 'public', 'js');

await mkdir(publicJs, { recursive: true });
await copyFile(
  resolve(root, 'js', 'ai-worker.generated.js'),
  resolve(publicJs, 'ai-worker.generated.js'),
);
await copyFile(
  resolve(root, 'CrownAndOak.html'),
  resolve(root, 'public', 'CrownAndOak.html'),
);

console.log('Copied AI worker and standalone build into public/.');
