import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const commands = [process.env.PYTHON, 'python', 'python3'].filter(Boolean);
let lastError = null;

for (const command of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (!result.error) {
    process.exit(result.status ?? 1);
  }
  lastError = result.error;
}

console.error(`Could not run Python (${commands.join(', ')}): ${lastError?.message || 'unknown error'}`);
process.exit(1);
