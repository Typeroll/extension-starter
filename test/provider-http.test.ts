import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { jwksFingerprint } from '../src/provider/security.js';
import { storage } from './fixtures/http-storage.js';

const issuer = 'https://issuer.example.test';
const origin = 'https://site.example.test';
const audience = 'com.example.quote-extension';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'ES256' }] };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(extra: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: 'ES256', kid: 'test' })}.${encode({ iss: issuer, aud: audience, sub: 'person', jti: crypto.randomUUID(), iat: now, exp: now + 60, installation_id: 'install-1', org_id: 'org', site_id: 'site', ...extra })}`;
  return `${data}.${crypto.sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

test('provider HTTP security and lifecycle contract', async t => {
  Object.assign(process.env, { NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', BASE_PATH: '/sample', TYPEROLL_LOCAL_DEVELOPMENT: '0',
    PROVIDER_STORAGE_MODULE: fileURLToPath(new URL('./fixtures/http-storage.ts', import.meta.url)),
    ALLOWED_SITE_ORIGINS: origin, TYPEROLL_CLIENT_ID: 'test-client', TYPEROLL_CLIENT_SECRET: crypto.randomBytes(32).toString('hex'), TYPEROLL_EVENT_SECRET: crypto.randomBytes(32).toString('hex') });
  const actualFetch = globalThis.fetch;
  let exchangeToken = token({ permission: 'admin', scopes: [], token_use: 'portal_admin' });
  let exchangeCount = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === `${issuer}/discovery`) return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
    if (url === `${issuer}/jwks`) return Response.json(jwks);
    if (url === `${issuer}/api/extensions/token`) { exchangeCount++; return Response.json({ access_token: exchangeToken }); }
    if (!url.startsWith('http://127.0.0.1:')) throw Error('Unexpected external test request');
    return actualFetch(input, init);
  }) as typeof fetch;
  const { server } = await import('../src/provider/server.js');
  if (!server.listening) await once(server, 'listening');
  const address = server.address();assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/sample`;
  const req = (path: string, init?: RequestInit) => actualFetch(base + path, init);
  const pubHeaders = (claims: Record<string, unknown> = {}) => ({ Origin: origin, 'X-Typeroll-Extension-Token': token({ token_use: 'public_extension', origin, ...claims }) });
  try {
    await t.test('CORS, base path and missing tokens', async () => {
      assert.equal((await req('/health')).status, 200);
      assert.equal((await actualFetch(`http://127.0.0.1:${address.port}/health`)).status, 404);
      assert.equal((await req('/typeroll/quotes/current', { method: 'OPTIONS', headers: { Origin: 'https://attacker.test' } })).status, 403);
      const cors = await req('/typeroll/quotes/current', { method: 'OPTIONS', headers: { Origin: origin } });
      assert.equal(cors.status, 204);assert.equal(cors.headers.get('access-control-allow-origin'), origin);
      assert.equal((await req('/typeroll/quotes/current', { headers: { Origin: origin } })).status, 401);
    });
    await t.test('pairing requires matching discovery, fingerprint and a signed nonce', async () => {
      const body = { issuer, discovery_url: `${issuer}/discovery`, nonce: 'nonce', assertion: token({ token_use: 'issuer_pairing', nonce: 'nonce' }), jwks_fingerprint: jwksFingerprint(jwks) };
      const pair = (changes: object) => req('/typeroll/pair', { method: 'POST', body: JSON.stringify({ ...body, ...changes }) });
      assert.equal((await pair({ jwks_fingerprint: 'wrong' })).status, 400);
      assert.equal((await pair({ nonce: 'other' })).status, 400);
      assert.equal((await pair({ discovery_url: 'https://other.test/discovery' })).status, 400);
      assert.equal((await pair({})).status, 200);
    });
    await t.test('quotes bind origin, audience, token use, expiry and installation', async () => {
      const path = '/typeroll/quotes/current?token=synthetic-recipient';
      for (const claims of [{ origin: 'https://other.test' }, { aud: 'other' }, { exp: 1 }, { exp: undefined }, { token_use: 'issuer_pairing' }, { iss: 'https://unknown.test' }]) {
        assert.equal((await req(path, { headers: pubHeaders(claims) })).status, 401);
      }
      assert.equal((await req(path, { headers: pubHeaders({ installation_id: 'other' }) })).status, 404);
      const current = await req(path, { headers: pubHeaders() });assert.equal(current.status, 200);
      assert.deepEqual(await current.json(), { title: 'Synthetic quote', total: 'EUR 100', approved: false });
      const approve = await req('/typeroll/quotes/approve', { method: 'POST', headers: pubHeaders(), body: JSON.stringify({ token: 'synthetic-recipient' }) });
      assert.equal(approve.status, 200);assert.equal((await approve.json()).approved, true);
    });
    await t.test('admin rejects public tokens and validates launch installation', async () => {
      assert.equal((await req('/admin')).status, 401);
      const publicToken = token({ token_use: 'public_extension', origin });
      assert.equal((await req('/admin', { headers: { Cookie: `quote_admin=${publicToken}` } })).status, 401);
      const launch = (installation = 'install-1', from = issuer) => req('/admin/launch', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ issuer: from, code: 'synthetic-code', installation_id: installation }) });
      assert.equal((await launch('install-1', 'https://unpaired.test')).status, 403);
      assert.equal(exchangeCount, 0);
      assert.equal((await launch('other')).status, 401);
      exchangeToken = publicToken;
      assert.equal((await launch()).status, 401);
      exchangeToken = token({ permission: 'admin', scopes: [], token_use: 'portal_admin' });
      const ok = await launch();assert.equal(ok.status, 303);
      assert.equal(ok.headers.get('location'), '/sample/admin');
      const cookie = ok.headers.get('set-cookie')!;
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=None', 'Path=/sample/admin']) assert.ok(cookie.includes(flag));
      assert.equal((await req('/admin', { headers: { Cookie: cookie.split(';')[0]! } })).status, 200);
    });
    await t.test('events reject tampering and stale timestamps and claim duplicates once', async () => {
      const body = JSON.stringify({ type: 'extension.installed', installation_id: 'install-1' });
      let accepted = 0;const claim = storage.eventReceipts.claim.bind(storage.eventReceipts);
      storage.eventReceipts.claim = async (...args) => { const fresh = await claim(...args);if (fresh) accepted++;return fresh; };
      const event = (timestamp = Math.floor(Date.now()/1000), content = body) => {
        const signature = crypto.createHmac('sha256', process.env.TYPEROLL_EVENT_SECRET!).update(`${timestamp}.${body}`).digest('hex');
        return req('/typeroll/events', { method: 'POST', headers: { 'X-Typeroll-Timestamp': String(timestamp), 'X-Typeroll-Signature': `v1=${signature}`, 'X-Typeroll-Event-Id': 'event-1' }, body: content });
      };
      assert.equal((await event(Math.floor(Date.now()/1000)-301)).status, 401);
      assert.equal((await event(undefined, body+' ')).status, 401);
      assert.equal((await event()).status, 200);assert.equal((await event()).status, 200);assert.equal(accepted, 1);
    });
  } finally { globalThis.fetch = actualFetch;server.closeAllConnections();await new Promise<void>((resolve,reject) => server.close(err=>err?reject(err):resolve())); }
});

test('production cannot enable the local auth bypass', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/provider/server.ts'], { env: { ...process.env, NODE_ENV: 'production', TYPEROLL_LOCAL_DEVELOPMENT: '1' }, stdio: 'pipe' });
  let error = '';child.stderr.on('data', chunk => { error += String(chunk); });
  const [code] = await once(child, 'exit');assert.notEqual(code, 0);
  assert.match(error, /Local development bypass is forbidden in production/);
});
