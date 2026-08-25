import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { IssuerTrustStore, verifyEventSignature, type PairingRequest } from './security.js';

const extensionId = 'com.example.quote-extension';
const port = Number(process.env.PORT || 8787);
const localDevelopment = process.env.TYPEROLL_LOCAL_DEVELOPMENT === '1';
const host = process.env.HOST || (localDevelopment ? '127.0.0.1' : '0.0.0.0');
const clientId = process.env.TYPEROLL_CLIENT_ID || '';
const clientSecret = process.env.TYPEROLL_CLIENT_SECRET || '';
const eventSecret = process.env.TYPEROLL_EVENT_SECRET || '';
const trustStore = new IssuerTrustStore(extensionId);
const deliveredEvents = new Set<string>();
const quotes = new Map([
  ['demo-customer-token', { title: 'Wedding package', total: 'SEK 24,900', approved: false }],
]);

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
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

function allowLocalCors(request: IncomingMessage, response: ServerResponse): void {
  if (!localDevelopment) return;
  const origin = request.headers.origin;
  if (origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

function validInstallation(request: IncomingMessage): boolean {
  if (localDevelopment) return true;
  const assertion = request.headers['x-typeroll-installation-assertion'];
  return typeof assertion === 'string' && Boolean(trustStore.verifyInstallation(assertion));
}

const server = http.createServer(async (request, response) => {
  allowLocalCors(request, response);
  if (request.method === 'OPTIONS' && localDevelopment) {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/typeroll/pair') {
      const result = await trustStore.pair(JSON.parse(await readBody(request)) as PairingRequest);
      sendJson(response, 200, { trusted: true, ...result });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/admin/launch') {
      const form = new URLSearchParams(await readBody(request));
      const issuer = form.get('issuer');
      const code = form.get('code');
      const installationId = form.get('installation_id');
      if (!issuer || !code || !installationId || !trustStore.has(issuer) || !clientId || !clientSecret) {
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
      const claims = token.access_token ? trustStore.verifyDelegatedUser(token.access_token) : undefined;
      if (!claims || claims.installation_id !== installationId) {
        sendJson(response, 401, { error: 'Invalid delegated user token' });
        return;
      }
      response.writeHead(303, {
        Location: '/admin',
        'Set-Cookie': `quote_admin=${encodeURIComponent(token.access_token!)}; HttpOnly; Secure; SameSite=None; Path=/admin`,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/admin') {
      const token = bearerCookie(request, 'quote_admin');
      const claims = token && trustStore.verifyDelegatedUser(token);
      if (!claims) {
        sendJson(response, 401, { error: 'Admin session is missing or expired' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html><body><main><h1>Quotes</h1><p>Provider-hosted admin surface.</p></main></body></html>');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/typeroll/quotes/current') {
      if (!validInstallation(request)) {
        sendJson(response, 401, { error: 'Invalid installation assertion' });
        return;
      }
      const quote = quotes.get(url.searchParams.get('token') || '');
      sendJson(response, quote ? 200 : 404, quote || { error: 'Quote not found' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/typeroll/quotes/approve') {
      if (!validInstallation(request)) {
        sendJson(response, 401, { error: 'Invalid installation assertion' });
        return;
      }
      const input = JSON.parse(await readBody(request)) as { token?: string };
      const quote = quotes.get(input.token || '');
      if (!quote) {
        sendJson(response, 404, { error: 'Quote not found' });
        return;
      }
      quote.approved = true;
      sendJson(response, 200, quote);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/typeroll/events') {
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
      if (!deliveredEvents.has(eventId)) {
        deliveredEvents.add(eventId);
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
  if (localDevelopment) console.log('Local development assertion bypass is enabled');
});
