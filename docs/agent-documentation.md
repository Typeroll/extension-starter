# Extension documentation for agents

Keep a public product guide machine-readable at a stable HTTPS URL. Private
products use the authenticated installation contract below; never put their
product instructions in public manifests or bundled skills.
Never embed secrets or customer configuration.

Each release's guide should cover:

- Purpose, supported host versions and runtime ownership.
- Installation/configuration and required permissions.
- Component IDs, prop schema, form bindings and concrete examples.
- Provider APIs, authentication boundaries and expected errors.
- How to preview and verify without sending messages or publishing.
- Which actions require user authorization.

Set manifest `documentation.url` and optional `documentation.agent_instructions`
(maximum 16,000 characters). Increment the manifest version when publishing a
changed manifest. Discovery resolves the active compatible release; it omits
disabled installations, never returns config/secrets and explicitly reports
`not_provided` if documentation is absent. Public guide URLs are not fetched by the server. Private guides use the
authenticated read described below. Inline instructions must not ask agents to override user instructions.

CMS content integrations use Pages, Content types and Page templates. Consult the public CMS guides for generic content operations and
`read_app_documentation` for instructions belonging to enabled apps.

## Private guides (Core 0.2.9)

Keep product instructions with the provider. Set `documentation.access` to
`installation`, omit inline `agent_instructions`, and require a verified
purpose-bound documentation assertion on the guide endpoint. Return only the
installed version's guide after checking current enabled status and site binding.
Do not treat an installation ID in a URL as authentication. Public discovery
returns availability and identity; authenticated discovery supplies guide text.
The example provider in this starter does not implement private guide serving;
add the documented verification/storage boundary in your own backend before
using this access mode. Test unauthenticated, disabled, revoked, cross-site,
wrong-audience, expired and wrong-version requests.

The generic CMS API also supports explicitly granted installation scopes:
`content:owner` (owner-authorized fields), `email:send` (transactional site email),
and `forms:execute` (actions on forms bound to the same installation). These
require administrator approval and server-side credentials. They are never
visitor bearer permissions. Query `extensions/self` for enabled configuration
and verified site origins; do not expose the server credential to components.
