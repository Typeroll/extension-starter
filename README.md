# Typeroll Extension starter

Use this repository as a template for an externally hosted Typeroll Extension.
It includes a bundled frontend block, opaque recipient-link handling, internal
navigation, gateway calls, provider-side assertion verification, admin SSO,
lifecycle webhook verification, a local runtime host, tests, and CI.

The example is a quote approval flow. Open one static page with a provider-owned
recipient token, load the matching quote, and approve it without creating
separate Typeroll paths for each screen.

## Quick start

Requirements: Node.js 22 or later.

```sh
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/?quote=demo-customer-token
```

The development command runs a Vite host and the sample provider together.
It explicitly enables a local-only installation-assertion bypass. The provider
does not enable that bypass when started or deployed directly.

## Repository layout

```text
src/frontend/       Extension block loaded by the Typeroll site
src/local-host/     Small browser host that mocks the public runtime
src/provider/       Provider API, issuer trust, admin SSO, and webhooks
scripts/            Development, manifest hash, and validation commands
test/               Runtime and security contract tests
typeroll-extension.json
```

## Customize the Extension

1. Replace `com.example.quote-extension` everywhere with your lowercase,
   namespaced Extension ID.
2. Change provider metadata and HTTPS origins in
   `typeroll-extension.json`.
3. Replace the sample quote model and in-memory data store with your own
   durable backend.
4. Keep recipient token generation, expiry, revocation, action scope, and
   replay rules in your provider backend.
5. Configure durable storage for paired issuer JWKS and processed lifecycle
   event IDs. The in-memory stores in this starter are development examples.
6. Deploy immutable frontend assets, update their URLs, and run
   `npm run manifest:sync` to record exact SHA-256 hashes.

## Build and verify

```sh
npm run check
```

This typechecks and bundles the browser module, synchronizes asset hashes,
runs runtime/security tests, and verifies the manifest against the built bytes.

CI additionally fails if a build changes a committed manifest hash. Commit a
new manifest hash whenever the frontend asset changes and release a new
semantic version before publishing it.

## Connect to Typeroll

Create an organization-scoped API key and set:

```sh
export TYPEROLL_API_URL="https://your-admin.example.com"
export TYPEROLL_API_KEY="your organization-scoped API key"
```

Then use the CLI bundled with `@typeroll/mcp-server`:

```sh
npm run extension:validate
npm run extension:push
npm run extension:install -- --site your-site-id --config extension-config.example.json
npm run extension:promote -- 1.0.0
```

The portal performs authoritative validation. Production asset and provider
URLs must be HTTPS and their origins must be registered as trusted origins.

## Recipient links and navigation

The manifest declares `?quote=…` as sensitive, consumed URL context. Typeroll
captures it when the block mounts, removes it from the visible URL, and exposes
it as `context.url.consume('quote_token')`. The frontend stores the returned
value in the mount closure. Calls to `context.navigation.navigate()` change the
block's internal view while retaining that value and keeping the same Typeroll
page path.

Typeroll does not validate the recipient token or make the resulting action
safe. The provider must use a cryptographically random, scoped, expiring,
revocable credential and authorize every API request.

## Provider deployment

`src/provider/server.ts` is a dependency-free Node reference server. Extract
the request handlers into the serverless adapter used by your deployment
platform, and replace all process-local maps with durable storage. The protocol
logic in `src/provider/security.ts` is kept separate so it can be reused by a
Cloudflare Worker with `nodejs_compat`, an AWS Lambda adapter, or a Vercel
function.

Production requirements:

- persist paired issuer/JWKS records and refresh them safely during rotation;
- persist lifecycle idempotency IDs for at least the provider retry window;
- validate every installation assertion and delegated user token;
- keep client credentials and webhook secrets in a secret manager;
- never log recipient tokens, JWTs, cookies, event bodies, or credentials;
- use a durable database for application data;
- serve versioned frontend assets immutably over HTTPS.

See [Typeroll Extension documentation](https://docs.typeroll.com/extensions/overview/)
for the full manifest and runtime contract.
