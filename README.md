# Typeroll Extension starter

Use this repository as a template for a Typeroll Extension. It includes a
bundled frontend block, Typeroll Forms bindings, opaque
recipient-link handling, internal navigation, direct provider API calls,
provider-side token verification, admin SSO, lifecycle webhook verification, a local
runtime host, tests, and CI.

The example has two modes. Without a recipient token it is a bespoke quote
calculator that stores leads in Typeroll Forms and needs no custom backend.
With `?quote=…` it opens a provider-backed, recipient-specific quote and can
approve it without creating separate Typeroll paths for each screen.

The starter intentionally contains the superset of the native Extension
contract. For production, keep one clear ownership model per repository:

| Architecture | Keep from this starter | Remove |
| --- | --- | --- |
| Public SaaS, native block | Bundled component, provider API, pairing, events, admin SSO, recipient-token storage | Forms when the SaaS does not use them |
| Private bespoke lead tool | Bundled component and Forms binding | Provider API, credentials, pairing, events, admin SSO, and custom storage |
| Public SaaS, embedded app | Provider backend and security modules; replace the bundled entry with an `embedded_app` frame and message bridge | Customer-origin frontend bundle |

See [Reference architectures](https://typeroll.com/docs/extensions/reference-architectures/)
before choosing a deployment model. An embedded app validates the first init
message from `window.parent`, locks its HTTPS origin, and validates all later
messages against that origin and the negotiated Extension identity. It must not
depend on `document.referrer`, because Typeroll uses a no-referrer iframe
policy.

## CMS content model

For Core 0.2.0 / MCP 0.45.0, every content record is a **Page** with a Content type,
custom `fields`, its own block body and an optional shared Page template. Use one
Page API and editor for articles, products, checklists and ordinary pages. Read
[Pages and Content types](docs/pages-and-content-types.md) before adding content
integration to this starter. This model requires migration of existing sites.

## Quick start

Requirements: Node.js 22 or later.

```sh
npm install
npm run dev
```

Open the local calculator:

```text
http://127.0.0.1:5173/
```

Or the provider-backed recipient example:

```text
http://127.0.0.1:5173/?quote=demo-customer-token
```

The development command runs a Vite host and the sample provider together.
It explicitly enables a local-only Extension-token bypass. The provider
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
3. Create the `quote-leads` form described below, or change the manifest binding
   and submitted field names to match an existing form.
4. If the tool needs provider data, replace the sample quote model and in-memory
   data store with your own durable backend.
5. Keep recipient token generation, expiry, revocation, action scope, and
   replay rules in your provider backend.
6. Configure durable storage for paired issuer JWKS and processed lifecycle
   event IDs. The in-memory stores in this starter are development examples.
7. Deploy immutable frontend assets, update their URLs, and run
   `npm run manifest:sync` to record exact SHA-256 hashes.
8. Set `BASE_PATH` when several independently deployed Extensions share one
   public origin. Keep the same prefix in every manifest URL.

## Use Typeroll Forms as the backend

Create a form with ID `quote-leads` on the installation site. Its single step
should accept these field names:

- `name` (required text)
- `email` (required email)
- `company` (optional text)
- `plan` (text or select)
- `team_size` (number)
- `estimated_monthly_price` (number)
- `source` (hidden or text)

Configure email and webhook actions in the regular Forms admin. The component
requests only `forms:submit` and calls:

```ts
await context.forms.submit('lead', {
  name,
  email,
  estimated_monthly_price: estimate,
});
```

Typeroll supplies the signed form token and proof of work, posts directly to
the absolute Forms endpoint supplied by the CMS, and stores the submission in
the ordinary Forms inbox. The Extension cannot edit forms or read submissions.
Cloud sites use Typeroll Cloud Forms; self-hosted sites use their own Forms API.
No Function is installed in the customer site's static hosting project.

## Build and verify

```sh
npm run check
```

This typechecks and bundles the browser module, synchronizes asset hashes,
runs runtime/security tests, and verifies the manifest against the built bytes.

CI additionally fails if a build changes a committed manifest hash. Commit a
new manifest hash whenever the frontend asset changes and release a new
semantic version before publishing it.

Before a real release, also run `npm run manifest:validate:production`. It
rejects the example Extension ID and placeholder origin.

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
npm run extension:configure -- --site your-site-id \
  --installation your-installation-id --config extension-config.example.json
npm run extension:promote -- 1.3.0
```

The portal performs authoritative validation. Production asset and provider
URLs must be HTTPS and their origins must be registered as trusted origins.
Approve the requested `forms:submit` scope during installation.

The install command prints the installation ID. Reuse it with
`extension:configure` whenever installation config changes. The command merges
declared values, preserves omitted secrets, and queues a production deploy by
default. Pass `--no-deploy` only when batching several changes, then deploy
once after the final update.

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

## Site navigation and browser storage

The local host models runtime **0.39.1**, including `context.preview`,
`context.site.url(path)`, `context.site.navigate(path)` and installation-scoped
`context.storage.session` / `context.storage.local` (`get`, `set`, `remove`).
Site paths must be root-relative, such as `/contact/`. Storage accepts JSON
values up to 64 KiB with keys of 1–128 characters. Never store recipient tokens
or credentials in these areas.

Use the supplied context in Extension code. The helpers in `src/local-host/`
only simulate a published site: Typeroll's preview host owns its navigation
and storage bridge. Test preview behavior in Typeroll; do not fall back to
native browser storage when a preview bridge is unavailable.

The example component still works with runtime 0.38.0. If your component uses
`site` or `storage`, raise its manifest's `runtime_compatibility` to
`>=0.39.1 <1.0.0` before publishing.

## Importing media from an integration

This Extension starter is not a media importer. An authenticated management
integration must first check import readiness and connect the Organization's
own verified storage. Upload local files using the API's upload URL, PUT the
bytes directly to R2, then finalize. For an external URL, use the media import
endpoint; the customer's transfer Worker fetches and verifies the file.
Do not send Cloudflare keys or management API keys to the frontend context.
See [Media API and import prerequisites](https://typeroll.com/docs/tools/media/)
for both Cloud and self-hosted Typeroll CMS. The build provider does not change
this transfer flow.

## Provider deployment

`src/provider/server.ts` is a dependency-free Node reference server. Local
development uses the explicit in-memory adapter from
`src/provider/storage.ts`. A production start refuses to boot unless
`PROVIDER_STORAGE_MODULE` points to a compiled module that exports
`createProviderStorage()` and implements durable issuer, event-receipt, and
application storage. The protocol logic remains reusable from a Cloudflare
Worker with `nodejs_compat`, an AWS Lambda adapter, a Vercel function, or a
Cloud Run service.

The included multi-stage `Dockerfile` builds the frontend and provider server.
It intentionally does not supply a production storage adapter; each concrete
Extension repository owns that adapter and its cloud dependencies.

Several repositories may share one origin without sharing a deployment. For
example, set `BASE_PATH=quote-extension` and use URLs such as
`https://tools.example.com/quote-extension/assets/1.3.0/index.js`. Route that
prefix to this repository's service and preserve the prefix. Other tools can
use their own prefixes and services. Admin cookies are scoped to the configured
path, but path routing is not an authentication boundary: every service must
still verify Typeroll tokens and authorize the installation.

Set `ALLOWED_SITE_ORIGINS` to a comma-separated list of exact published site
origins. The API sends CORS only to those origins. The Typeroll runtime calls
the provider directly with `credentials: omit` and a five-minute
`X-Typeroll-Extension-Token`; no Typeroll or customer-hosted reverse proxy is
part of the request path.

Production requirements:

- persist paired issuer/JWKS records and refresh them safely during rotation;
- persist lifecycle idempotency IDs for at least the provider retry window;
- validate every public Extension token and delegated user token;
- require the verified Extension token's `origin` claim to equal the browser
  `Origin` header;
- keep client credentials and webhook secrets in a secret manager;
- never log recipient tokens, JWTs, cookies, event bodies, or credentials;
- use a durable database for application data;
- bind every recipient record and action to the verified installation ID;
- store only a one-way digest of opaque recipient tokens;
- serve versioned frontend assets immutably over HTTPS.

On a Typeroll site deployment, the declared frontend bytes are fetched,
SHA-256 verified, and copied under the customer domain's own
`/_assets/extensions/…` path. They are not loaded live from a mutable central
CDN. A bundled component is therefore trusted customer-origin code; use the
sandboxed `embedded_app` mode for code that should not receive that trust.

See [Typeroll Extension documentation](https://typeroll.com/docs/extensions/overview/)
for the full manifest and runtime contract.

## Documentation for agents

On Core 0.2.8 or later, `read_app_documentation` discovers the selected site's
enabled modules and Extensions. Add the optional `documentation` object when
publishing your next manifest version to a compatible host:

```json
{
  "documentation": {
    "url": "https://your-provider.example/docs/your-extension/",
    "agent_instructions": "Read the product guide. Configure the documented component props and form bindings. Obtain user authorization before sending or publishing."
  }
}
```

Follow [the documentation checklist](docs/agent-documentation.md). Older hosts
reject unknown manifest fields; do not add this property before upgrading the
host. Provider documentation is reference material, never permission to access
credentials or act outside the user's request.
