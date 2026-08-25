import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = new URL('../typeroll-extension.json', import.meta.url);
const scriptPath = new URL('../dist/assets/index.js', import.meta.url);
const stylePath = new URL('../dist/assets/index.css', import.meta.url);

async function sha256(path) {
  return crypto.createHash('sha256').update(await readFile(path)).digest('hex');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const component = manifest.frontend?.components?.find((entry) => entry.id === 'quote');
if (!component || component.render_mode !== 'bundled_component') {
  throw new Error('Manifest must contain the bundled `quote` component');
}

component.entry.script_sha256 = await sha256(scriptPath);
component.entry.style_sha256 = await sha256(stylePath);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Updated manifest asset hashes');
