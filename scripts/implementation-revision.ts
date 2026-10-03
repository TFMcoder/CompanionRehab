import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const roots = ['src', 'tests', 'scripts', 'db'];
const files = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'index.html', '.env.example'];
async function scan(path: string) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = join(path, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await scan(name);
    else if (entry.isFile() && /\.(ts|tsx|css|sql|ps1)$/.test(name)) files.push(name);
  }
}
for (const root of roots) await scan(root);
const hash = createHash('sha256');
for (const name of files.sort()) { hash.update(name + '\0'); hash.update(await readFile(name)); hash.update('\0'); }
console.log('sha256:' + hash.digest('hex'));
