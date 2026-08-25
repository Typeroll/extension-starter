import crypto from 'node:crypto';
import { createMemoryProviderStorage, type TrustedIssuerRecord, type TrustedIssuerRepository } from './storage.js';

export interface JwtClaims {
  iss: string;
  aud: string;
  sub: string;
  org_id?: string;
  site_id?: string;
  installation_id?: string;
  permission?: string;
  scopes?: string[];
  token_use?: string;
  nonce?: string;
  jti: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

interface JsonWebKeySet {
  keys: Array<crypto.JsonWebKey & { kid?: string; alg?: string }>;
}

interface ExpectedClaims {
  issuer: string;
  audience: string;
  tokenUse?: string;
  nonce?: string;
}

export interface PairingRequest {
  issuer: string;
  discovery_url: string;
  assertion: string;
  nonce: string;
  jwks_fingerprint: string;
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function unverifiedClaims(token: string): JwtClaims | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    return decodeJsonPart<JwtClaims>(payload);
  } catch {
    return undefined;
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function jwksFingerprint(jwks: JsonWebKeySet): string {
  return crypto.createHash('sha256').update(canonicalJson(jwks)).digest('hex');
}

export function recipientTokenDigest(extensionId: string, token: string): string {
  return crypto.createHash('sha256').update(`${extensionId}\0${token}`).digest('hex');
}

export function verifyEs256Jwt(
  token: string,
  jwks: JsonWebKeySet,
  expected: ExpectedClaims,
  now = new Date(),
): JwtClaims | undefined {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return undefined;

  try {
    const header = decodeJsonPart<{ alg?: string; kid?: string }>(encodedHeader);
    const claims = decodeJsonPart<JwtClaims>(encodedPayload);
    const key = jwks.keys.find((candidate) => candidate.kid === header.kid);
    if (!key || header.alg !== 'ES256' || (key.alg && key.alg !== 'ES256')) return undefined;

    const valid = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key: crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(encodedSignature, 'base64url'),
    );
    const epoch = Math.floor(now.getTime() / 1000);
    if (!valid || claims.iss !== expected.issuer || claims.aud !== expected.audience) return undefined;
    if (!claims.jti || !claims.sub || claims.exp <= epoch || claims.iat > epoch + 30) return undefined;
    if (expected.tokenUse && claims.token_use !== expected.tokenUse) return undefined;
    if (expected.nonce && claims.nonce !== expected.nonce) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

export function verifyEventSignature(
  rawBody: string,
  timestamp: string,
  signatureHeader: string,
  secret: string,
  now = new Date(),
): boolean {
  const provided = signatureHeader.replace(/^v1=/, '');
  if (!secret || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(provided)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

export class IssuerTrustStore {
  readonly #extensionId: string;
  readonly #repository: TrustedIssuerRepository;
  readonly #issuers = new Map<string, TrustedIssuerRecord>();

  constructor(extensionId: string, repository: TrustedIssuerRepository = createMemoryProviderStorage().trustedIssuers) {
    this.#extensionId = extensionId;
    this.#repository = repository;
  }

  async #get(issuer: string): Promise<TrustedIssuerRecord | undefined> {
    const cached = this.#issuers.get(issuer);
    if (cached) return cached;
    const stored = await this.#repository.get(issuer);
    if (stored) this.#issuers.set(issuer, stored);
    return stored;
  }

  async pair(input: PairingRequest): Promise<{ issuer: string; nonce: string; jwks_fingerprint: string }> {
    const issuer = new URL(input.issuer);
    const discoveryUrl = new URL(input.discovery_url);
    if (issuer.protocol !== 'https:' || issuer.origin !== input.issuer || discoveryUrl.origin !== issuer.origin) {
      throw new Error('Pairing issuer and discovery URL must use the same HTTPS origin');
    }

    const discoveryResponse = await fetch(discoveryUrl);
    if (!discoveryResponse.ok) throw new Error('Issuer discovery failed');
    const discovery = await discoveryResponse.json() as { issuer?: string; jwks_uri?: string };
    if (discovery.issuer !== input.issuer || !discovery.jwks_uri) throw new Error('Invalid issuer discovery document');

    const jwksUrl = new URL(discovery.jwks_uri);
    if (jwksUrl.protocol !== 'https:' || jwksUrl.origin !== issuer.origin) throw new Error('JWKS must use the issuer origin');
    const jwksResponse = await fetch(jwksUrl);
    if (!jwksResponse.ok) throw new Error('Issuer JWKS fetch failed');
    const jwks = await jwksResponse.json() as JsonWebKeySet;
    if (!Array.isArray(jwks.keys) || !jwks.keys.length) throw new Error('Issuer JWKS is empty');

    const fingerprint = jwksFingerprint(jwks);
    if (fingerprint !== input.jwks_fingerprint) throw new Error('Issuer JWKS fingerprint mismatch');
    const claims = verifyEs256Jwt(input.assertion, jwks, {
      issuer: input.issuer,
      audience: this.#extensionId,
      tokenUse: 'issuer_pairing',
      nonce: input.nonce,
    });
    if (!claims) throw new Error('Invalid issuer pairing assertion');

    const record: TrustedIssuerRecord = {
      issuer: input.issuer,
      jwks,
      fingerprint,
      updated_at: new Date().toISOString(),
    };
    await this.#repository.put(record);
    this.#issuers.set(input.issuer, record);
    return { issuer: input.issuer, nonce: input.nonce, jwks_fingerprint: fingerprint };
  }

  async verifyPublicConnector(token: string): Promise<JwtClaims | undefined> {
    const claims = unverifiedClaims(token);
    if (!claims) return undefined;
    const trust = await this.#get(claims.iss);
    if (!trust) return undefined;
    return verifyEs256Jwt(token, trust.jwks, {
      issuer: claims.iss,
      audience: this.#extensionId,
      tokenUse: 'public_connector',
    });
  }

  async verifyDelegatedUser(token: string): Promise<JwtClaims | undefined> {
    const claims = unverifiedClaims(token);
    if (!claims) return undefined;
    const trust = await this.#get(claims.iss);
    if (!trust) return undefined;
    return verifyEs256Jwt(token, trust.jwks, {
      issuer: claims.iss,
      audience: this.#extensionId,
    });
  }

  async has(issuer: string): Promise<boolean> {
    return Boolean(await this.#get(issuer));
  }
}
