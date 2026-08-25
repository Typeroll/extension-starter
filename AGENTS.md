# Typeroll Extension starter instructions

- Use Node.js 22 or later.
- Run `npm run check` after changing runtime, provider, manifest, or build code.
- Run `npm run manifest:sync` after changing frontend assets and increment the
  manifest version before publishing changed bytes.
- Never enable `TYPEROLL_LOCAL_DEVELOPMENT=1` in a deployed environment.
- Recipient URL tokens belong to the provider. Do not persist or log them in
  Typeroll data, generated HTML, diagnostics, or analytics.
- Do not trust an issuer, site, organization, installation, or user identifier
  from browser input. Derive it from a verified Typeroll assertion.
- Store production client credentials, event secrets, paired issuer records,
  lifecycle idempotency records, and application data in durable services.
- Keep code, identifiers, comments, routes, API fields, tests, and logs in
  English.
