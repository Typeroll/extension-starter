import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verifyEs256Jwt, verifyEventSignature } from '../src/provider/security.js';

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('verifies a scoped ES256 public Extension token', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const now = new Date('2026-08-25T12:00:00.000Z');
  const header = encoded({ alg: 'ES256', typ: 'JWT', kid: 'test-key' });
  const payload = encoded({
    iss: 'https://admin.example.com',
    aud: 'com.example.quote-extension',
    sub: 'install-1',
    token_use: 'public_extension',
    origin: 'https://customer.example',
    installation_id: 'install-1',
    jti: 'assertion-1',
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 60,
  });
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  const claims = verifyEs256Jwt(`${header}.${payload}.${signature}`, {
    keys: [{ ...jwk, kid: 'test-key', alg: 'ES256' }],
  }, {
    issuer: 'https://admin.example.com',
    audience: 'com.example.quote-extension',
    tokenUse: 'public_extension',
  }, now);

  assert.equal(claims?.installation_id, 'install-1');
  assert.equal(verifyEs256Jwt(`${header}.${payload}.${signature}`, {
    keys: [{ ...jwk, kid: 'test-key', alg: 'ES256' }],
  }, {
    issuer: 'https://other.example.com',
    audience: 'com.example.quote-extension',
    tokenUse: 'public_extension',
  }, now), undefined);
});

test('verifies fresh lifecycle signatures and rejects stale timestamps', () => {
  const secret = 'test-secret-at-least-32-characters';
  const body = '{"type":"extension.installed"}';
  const now = new Date('2026-08-25T12:00:00.000Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  assert.equal(verifyEventSignature(body, timestamp, `v1=${signature}`, secret, now), true);
  assert.equal(verifyEventSignature(body, timestamp, `v1=${signature}`, secret, new Date(now.getTime() + 301_000)), false);
  assert.equal(verifyEventSignature(`${body} `, timestamp, `v1=${signature}`, secret, now), false);
});
