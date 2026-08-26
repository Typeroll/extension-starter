import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { IssuerTrustStore, recipientTokenDigest, verifyEventSignature, type PairingRequest } from './security.js';
import { createMemoryProviderStorage, type ProviderStorage, type ProviderStorageFactory } from './storage.js';

const extensionId = process.env.TYPEROLL_EXTENSION_ID || 'com.example.quote-extension';
const port = Number(process.env.PORT || 8787);
const localDevelopment = process.env.TYPEROLL_LOCAL_DEVELOPMENT === '1';
const host = process.env.HOST || (localDevelopment ? '127.0.0.1' : '0.0.0.0');
const basePath = `/${String(process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
const extensionVersion = process.env.EXTENSION_VERSION || '1.3.0';
const clientId = process.env.TYPEROLL_CLIENT_ID || '';
const clientSecret = process.env.TYPEROLL_CLIENT_SECRET || '';
const eventSecret = process.env.TYPEROLL_EVENT_SECRET || '';
const allowedSiteOrigins = new Set(
  String(process.env.ALLOWED_SITE_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin),
);

async function loadStorage(): Promise<ProviderStorage> {
  if (localDevelopment) {
    return createMemoryProviderStorage([[
      recipientTokenDigest(extensionId, 'demo-customer-token'),
      { installation_id: 'local-installation', title: 'Wedding package', total: 'SEK 24,900', approved: false },
    ]]);
  }
  const adapter = process.env.PROVIDER_STORAGE_MODULE?.trim();
  if (!adapter) throw new Error('PROVIDER_STORAGE_MODULE must point to a durable production storage adapter');
  const moduleUrl = adapter.startsWith('file:') ? adapter : pathToFileURL(adapter).href;
  const loaded = await import(moduleUrl) as { createProviderStorage?: ProviderStorageFactory };
  if (typeof loaded.createProviderStorage !== 'function') {
    throw new Error('PROVIDER_STORAGE_MODULE must export createProviderStorage()');
  }
  return loaded.createProviderStorage();
}

const storage = await loadStorage();
const trustStore = new IssuerTrustStore(extensionId, storage.trustedIssuers);

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function sendHtml(response: ServerResponse, status: number, title: string, body: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors https:",
  });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body><main><h1>${title}</h1>${body}</main></body></html>`);
}

async function readBody(request: IncomingMessage, maximum = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maximum) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function bearerCookie(request: IncomingMessage, name: string): string | undefined {
  const cookie = request.headers.cookie?.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

function allowSiteCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  const allowed = typeof origin === 'string' && (
    (localDevelopment && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) ||
    allowedSiteOrigins.has(origin)
  );
  if (!allowed) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Typeroll-Extension-Token');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return true;
}

async function installationId(request: IncomingMessage): Promise<string | undefined> {
  if (localDevelopment) return 'local-installation';
  const token = request.headers['x-typeroll-extension-token'];
  if (typeof token !== 'string' || typeof request.headers.origin !== 'string') return undefined;
  const claims = await trustStore.verifyPublicExtension(token);
  if (claims?.origin !== request.headers.origin) return undefined;
  return typeof claims?.installation_id === 'string' && claims.installation_id ? claims.installation_id : undefined;
}

function publicQuote(quote: { title: string; total: string; approved: boolean }): { title: string; total: string; approved: boolean } {
  return { title: quote.title, total: quote.total, approved: quote.approved };
}

function route(pathname: string): string | undefined {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
}

const server = http.createServer(async (request, response) => {
  const corsAllowed = allowSiteCors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(corsAllowed ? 204 : 403).end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const pathname = route(url.pathname);
  try {
    if (!pathname) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');

    if (request.method === 'GET' && pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && pathname === '/support') {
      sendHtml(response, 200, 'Extension support', '<p>Contact the Extension provider for support.</p>');
      return;
    }

    if (request.method === 'GET' && pathname === '/privacy') {
      sendHtml(response, 200, 'Extension privacy', '<p id="retention">Document the provider data handling and retention policy here.</p>');
      return;
    }

    const asset = pathname.match(/^\/assets\/([^/]+)\/(index\.(?:js|css))$/);
    if (request.method === 'GET' && asset?.[1] === extensionVersion && asset[2]) {
      const bytes = await readFile(new URL(`../assets/${asset[2]}`, import.meta.url));
      response.writeHead(200, {
        'Content-Type': asset[2].endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': bytes.byteLength,
      });
      response.end(bytes);
      return;
    }

    if (request.method === 'POST' && pathname === '/typeroll/pair') {
      const result = await trustStore.pair(JSON.parse(await readBody(request)) as PairingRequest);
      sendJson(response, 200, { trusted: true, ...result });
      return;
    }

    if (request.method === 'POST' && pathname === '/admin/launch') {
      const form = new URLSearchParams(await readBody(request));
      const issuer = form.get('issuer');
      const code = form.get('code');
      const installationId = form.get('installation_id');
      if (!issuer || !code || !installationId || !await trustStore.has(issuer) || !clientId || !clientSecret) {
        sendJson(response, 403, { error: 'Issuer is not paired or provider credentials are missing' });
        return;
      }
      const exchanged = await fetch(`${issuer}/api/extensions/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret }),
      });
      if (!exchanged.ok) {
        sendJson(response, 401, { error: 'Launch code exchange failed' });
        return;
      }
      const token = await exchanged.json() as { access_token?: string };
      const claims = token.access_token ? await trustStore.verifyDelegatedUser(token.access_token) : undefined;
      if (!claims || claims.installation_id !== installationId) {
        sendJson(response, 401, { error: 'Invalid delegated user token' });
        return;
      }
      response.writeHead(303, {
        Location: `${basePath}/admin`,
        'Set-Cookie': `quote_admin=${encodeURIComponent(token.access_token!)}; HttpOnly; Secure; SameSite=None; Path=${basePath}/admin`,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && pathname === '/admin') {
      const token = bearerCookie(request, 'quote_admin');
      const claims = token ? await trustStore.verifyDelegatedUser(token) : undefined;
      if (!claims) {
        sendJson(response, 401, { error: 'Admin session is missing or expired' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html><body><main><h1>Quotes</h1><p>Provider-hosted admin surface.</p></main></body></html>');
      return;
    }

    if (pathname.startsWith('/typeroll/quotes/') && !corsAllowed) {
      sendJson(response, 403, { error: 'Site origin is not allowed' });
      return;
    }

    if (request.method === 'GET' && pathname === '/typeroll/quotes/current') {
      const currentInstallationId = await installationId(request);
      if (!currentInstallationId) {
        sendJson(response, 401, { error: 'Invalid public Extension token' });
        return;
      }
      const token = url.searchParams.get('token') || '';
      const quote = token
        ? await storage.quotes.getByRecipientDigest(recipientTokenDigest(extensionId, token), currentInstallationId)
        : undefined;
      sendJson(response, quote ? 200 : 404, quote ? publicQuote(quote) : { error: 'Quote not found' });
      return;
    }

    if (request.method === 'POST' && pathname === '/typeroll/quotes/approve') {
      const currentInstallationId = await installationId(request);
      if (!currentInstallationId) {
        sendJson(response, 401, { error: 'Invalid public Extension token' });
        return;
      }
      const input = JSON.parse(await readBody(request)) as { token?: string };
      const quote = input.token
        ? await storage.quotes.approveByRecipientDigest(recipientTokenDigest(extensionId, input.token), currentInstallationId)
        : undefined;
      if (!quote) {
        sendJson(response, 404, { error: 'Quote not found' });
        return;
      }
      sendJson(response, 200, publicQuote(quote));
      return;
    }

    if (request.method === 'POST' && pathname === '/typeroll/events') {
      const rawBody = await readBody(request);
      const timestamp = String(request.headers['x-typeroll-timestamp'] || '');
      const signature = String(request.headers['x-typeroll-signature'] || '');
      const eventId = String(request.headers['x-typeroll-event-id'] || '');
      if (!verifyEventSignature(rawBody, timestamp, signature, eventSecret)) {
        sendJson(response, 401, { error: 'Invalid event signature' });
        return;
      }
      if (!eventId) {
        sendJson(response, 400, { error: 'Missing event ID' });
        return;
      }
      if (await storage.eventReceipts.claim(eventId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))) {
        const event = JSON.parse(rawBody) as { type?: string; installation_id?: string };
        // Log stable metadata only. Never log event bodies, secrets, or recipient tokens.
        console.log(`Received ${event.type || 'unknown'} for installation ${event.installation_id || 'unknown'}`);
      }
      sendJson(response, 200, { received: true });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Provider request failed');
    sendJson(response, 400, { error: 'Invalid request' });
  }
});

server.listen(port, host, () => {
  console.log(`Quote provider listening on ${host}:${port}`);
  if (localDevelopment) console.log('Local development Extension-token bypass is enabled');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) console.error(error.message);
      process.exit(error ? 1 : 0);
    });
  });
}
