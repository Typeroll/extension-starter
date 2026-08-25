import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifestPath = new URL('../typeroll-extension.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const errors = [];
const production = process.argv.includes('--production');

if (manifest.schema_version !== 2) errors.push('schema_version must be 2');
if (!/^[a-z0-9]+(?:[.-][a-z0-9][a-z0-9-]*){2,}$/.test(manifest.id || '')) errors.push('id must be a lowercase namespaced identifier');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version || '')) errors.push('version must be semver');
if (!['private', 'unlisted', 'public'].includes(manifest.distribution)) errors.push('distribution is invalid');
if (production && String(manifest.id).startsWith('com.example.')) errors.push('production manifest must use your own Extension id');

async function sha256(path) {
  return crypto.createHash('sha256').update(await readFile(path)).digest('hex');
}

const components = manifest.frontend?.components || [];
for (const [index, component] of components.entries()) {
  const prefix = `frontend.components[${index}]`;
  if (!component.id || !component.label) errors.push(`${prefix} needs id and label`);
  if (component.render_mode === 'bundled_component') {
    for (const key of ['script_url', 'style_url']) {
      if (component.entry[key] && new URL(component.entry[key]).protocol !== 'https:') errors.push(`${prefix}.${key} must use HTTPS`);
    }
    if (!/^[a-f0-9]{64}$/.test(component.entry.script_sha256 || '')) errors.push(`${prefix}.script_sha256 is invalid`);
    if (component.entry.style_url && !/^[a-f0-9]{64}$/.test(component.entry.style_sha256 || '')) errors.push(`${prefix}.style_sha256 is invalid`);
  }
}

const quote = components.find((component) => component.id === 'quote');
try {
  if (quote?.entry.script_sha256 !== await sha256(new URL('../dist/assets/index.js', import.meta.url))) errors.push('built JavaScript hash does not match the manifest');
  if (quote?.entry.style_sha256 !== await sha256(new URL('../dist/assets/index.css', import.meta.url))) errors.push('built CSS hash does not match the manifest');
} catch {
  errors.push('built assets are missing; run npm run build first');
}

const executionUrls = [
  ...(components.flatMap((component) => Object.entries(component.entry || {}).filter(([key]) => key.endsWith('_url')).map(([, value]) => value))),
  ...(manifest.admin?.pages || []).map((page) => page.launch_url),
  manifest.auth?.pairing_url,
  manifest.api?.base_url,
  manifest.events?.webhook_url,
].filter(Boolean);
for (const value of executionUrls) {
  try {
    if (new URL(value).protocol !== 'https:') errors.push(`${value} must use HTTPS`);
  } catch {
    errors.push(`${value} is not a valid URL`);
  }
}
if (production && executionUrls.some((value) => new URL(value).hostname === 'extension.example.com')) {
  errors.push('production manifest must replace extension.example.com URLs');
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('typeroll-extension.json and built asset hashes are valid');
}
